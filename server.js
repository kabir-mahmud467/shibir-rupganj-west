require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
let MongoStore = require('connect-mongo');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const crypto = require('crypto');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';

function safeTimingEqual(a, b) {
    const aBuf = Buffer.from(String(a ?? ''), 'utf8');
    const bBuf = Buffer.from(String(b ?? ''), 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    // Minimal CSP (inline CSS exists).
    const csp = [
        "default-src 'self'",
        "connect-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "img-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
        "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com"
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);

    next();
}

function stripDangerousKeys(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        for (const item of value) stripDangerousKeys(item);
        return value;
    }
    for (const key of Object.keys(value)) {
        if (key.startsWith('$') || key.includes('.')) {
            delete value[key];
            continue;
        }
        stripDangerousKeys(value[key]);
    }
    return value;
}

function createRateLimiter({ windowMs, max, message, keyGenerator }) {
    const hits = new Map();
    const cleanupIntervalMs = Math.max(10_000, Math.min(windowMs, 60_000));
    const cleanup = () => {
        const now = Date.now();
        for (const [key, record] of hits) {
            if (record.resetAt <= now) hits.delete(key);
        }
    };
    const interval = setInterval(cleanup, cleanupIntervalMs);
    if (interval.unref) interval.unref();

    return (req, res, next) => {
        const now = Date.now();
        const key = (keyGenerator ? keyGenerator(req) : req.ip) || 'unknown';
        const record = hits.get(key);

        if (!record || record.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        record.count += 1;

        const remaining = Math.max(0, max - record.count);
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));

        if (record.count > max) {
            res.setHeader('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)));
            return res.status(429).send(message || 'Too many requests');
        }

        return next();
    };
}

const PASSWORD_HASH_PREFIX = 'pbkdf2$sha256$';
const PASSWORD_PBKDF2_ITERATIONS = Number(process.env.PASSWORD_PBKDF2_ITERATIONS || 310_000);
const PASSWORD_KEYLEN_BYTES = 32;

function hashPassword(rawPassword) {
    const password = String(rawPassword ?? '');
    const minLen = Number(process.env.PASSWORD_MIN_LENGTH || 6);
    if (password.length < minLen) throw new Error(`Password too short (min ${minLen})`);
    const salt = crypto.randomBytes(16).toString('base64url');
    const iterations = PASSWORD_PBKDF2_ITERATIONS;
    const derived = crypto.pbkdf2Sync(password, salt, iterations, PASSWORD_KEYLEN_BYTES, 'sha256').toString('base64url');
    return `${PASSWORD_HASH_PREFIX}${iterations}$${salt}$${derived}`;
}

function verifyPassword(rawPassword, storedPassword) {
    const password = String(rawPassword ?? '');
    const stored = String(storedPassword ?? '');

    if (stored.startsWith(PASSWORD_HASH_PREFIX)) {
        const rest = stored.slice(PASSWORD_HASH_PREFIX.length);
        const [iterationsStr, salt, expected] = rest.split('$');
        const iterations = Number(iterationsStr);
        if (!iterations || !salt || !expected) return false;
        const derived = crypto.pbkdf2Sync(password, salt, iterations, PASSWORD_KEYLEN_BYTES, 'sha256').toString('base64url');
        return safeTimingEqual(derived, expected);
    }

    // Legacy plaintext fallback (will be upgraded on successful login where possible)
    return safeTimingEqual(password, stored);
}

function getCsrfToken(req) {
    if (!req.session) return null;
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString('base64url');
    }
    return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    const contentType = String(req.headers['content-type'] || '');
    if (contentType.startsWith('multipart/form-data')) return next(); // validated after multer

    const expected = getCsrfToken(req);
    const provided = String(req.body?._csrf || req.query?._csrf || req.get('x-csrf-token') || '');
    if (!expected || !provided || !safeTimingEqual(provided, expected)) {
        if (req.path && String(req.path).startsWith('/api/')) {
            return res.status(403).json({ ok: false, message: 'CSRF validation failed' });
        }
        return res.status(403).render('access-denied');
    }
    return next();
}

function requireCsrfAfterMultipart(req, res, next) {
    const expected = getCsrfToken(req);
    const provided = String(req.body?._csrf || req.query?._csrf || req.get('x-csrf-token') || '');
    if (!expected || !provided || !safeTimingEqual(provided, expected)) {
        return res.status(403).render('access-denied');
    }
    return next();
}

// --- ১. কনফিগারেশন ---
const MONGO_URI = process.env.MONGODB_URI;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- ২. ডাটাবেজ মডেল (Schema) ---

const MemberSchema = new mongoose.Schema({
    name: String, 
    father: String, 
    mother: String, 
    dob: String, 
    phone: String,
    guardian_phone: String, 
    facebook: String, 
    present_address: String,
    permanent_address: String, 
    type: String, 
    edu: String, 
    inst: String,
    ward: String, 
    branch: String, 
    responsibility: String, 
    comment: String,
    password: { type: String, unique: true }, 
    photo: String,
    baitul_mal_amount: { type: Number, default: 0 },
    baitul_mal_payment: { type: [Boolean], default: () => Array(12).fill(false) }
});
const Member = mongoose.models.Member || mongoose.model('Member', MemberSchema);

const NoticeSchema = new mongoose.Schema({
    title: String, 
    content: String, visibility: String,
    date: { type: String, default: () => new Date().toLocaleDateString('bn-BD') }
});
const Notice = mongoose.models.Notice || mongoose.model('Notice', NoticeSchema);

const ResourceSchema = new mongoose.Schema({
    title: String, 
    visibility: String, 
    url: String, 
    imageUrl: String
});
const Resource = mongoose.models.Resource || mongoose.model('Resource', ResourceSchema);

const SlideSchema = new mongoose.Schema({
    title: String, 
    caption: String, 
    imageUrl: String, 
    link: String,
    createdAt: { type: Date, default: Date.now }
});
const Slide = mongoose.models.Slide || mongoose.model('Slide', SlideSchema);

const ArchiveItemSchema = new mongoose.Schema({
    title: String, 
    description: String, 
    itemType: String, 
    url: String,
    createdAt: { type: Date, default: Date.now }
});
const ArchiveItem = mongoose.models.ArchiveItem || mongoose.model('ArchiveItem', ArchiveItemSchema);

const HistoryItemSchema = new mongoose.Schema({
    category: String,
    title: String,
    body: String,
    extra: String,
    role: String,
    tenure: String,
    imageUrl: String,
    createdAt: { type: Date, default: Date.now }
});
const HistoryItem = mongoose.models.HistoryItem || mongoose.model('HistoryItem', HistoryItemSchema);


const ApplicationSchema = new mongoose.Schema({
    name: String, 
    phone: String, 
    email: String, 
    institution: String,
    class_year: String, 
    roll: String, 
    address: String, 
    ward: String,
    branch: String, 
    guardian_phone: String, 
    note: String,
    date: { type: String, default: () => new Date().toLocaleDateString('bn-BD') }
});
const Application = mongoose.models.Application || mongoose.model('Application', ApplicationSchema);

const SupporterSchema = new mongoose.Schema({
    name: String,
    address: String,
    phone: String,
    profession: String,
    facebook: String,
    photo: String,
    password: { type: String, unique: true },
    target_amount: { type: Number, default: 0 },
    payments: { type: [Boolean], default: () => Array(12).fill(false) },
    createdAt: { type: Date, default: Date.now }
});
const Supporter = mongoose.models.Supporter || mongoose.model('Supporter', SupporterSchema);


// --- ৩. ক্লাউডিনারি আপলোড সেটিংস ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'rupganj_west',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    },
    fileFilter: (_req, file, cb) => {
        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
        if (!allowed.has(file.mimetype)) {
            return cb(new Error('Invalid file type. Only JPG/PNG/WEBP allowed.'));
        }
        return cb(null, true);
    }
});

// --- ৪. মিডলওয়্যার ও সেশন ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (IS_PROD) app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(createRateLimiter({
    windowMs: 60 * 1000,
    max: 240,
    message: 'ওয়েব পেজ অনেক বেশি রিফ্রেশ করা হচ্ছে। সার্ভারের সুরক্ষা নিশ্চিত করতে আপনি আপাতত সাইট ভিজিট করতে পারবেন না। কিছুক্ষণ পর আবার চেষ্টা করুন।'
}));
app.use('/login-page', createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 5,
    message: 'ভূল পাসওয়ার্ড দিয়ে লগইনের চেষ্টা অনেক বেশি হয়ে গেছে। সার্ভারের সুরক্ষা নিশ্চিত করতে আপনি আপাতত লগ ইন করতে পারবেন না। ৫ মিনিট পর আবার চেষ্টা করুন।'
}));
app.use('/admin', createRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    message: 'একই আইপি থেকে সার্ভারে অত্যধিক রিকোয়েস্টের কারণে ডেটাবেজের নিরাপত্তা নিশ্চিত করতে আপনার অ্যাডমিন প্যানেল অ্যাক্সেস সাময়িকভাবে স্থগিত করা হয়েছে। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।'
}));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));
app.use(express.urlencoded({ extended: true, limit: '50kb', parameterLimit: 200 }));
app.use(express.json({ limit: '50kb' }));
app.use((req, _res, next) => {
    stripDangerousKeys(req.body);
    stripDangerousKeys(req.query);
    stripDangerousKeys(req.params);
    next();
});

if (MongoStore.default) { MongoStore = MongoStore.default; }

const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PROD ? null : 'dev-session-secret-change-me');
const SESSION_STORE_SECRET = process.env.SESSION_STORE_SECRET || SESSION_SECRET;
if (IS_PROD && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET must be set (>= 32 chars) in production.');
}

app.use(session({
    name: 'rw.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: IS_PROD,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        ttl: 60 * 60 * 24 * 7,
        touchAfter: 24 * 3600,
        crypto: { secret: SESSION_STORE_SECRET }
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PROD
    }
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

app.use((req, res, next) => {
    res.locals.csrfToken = getCsrfToken(req);
    next();
});

app.use(requireCsrf);

// Favicon 
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- ৫ দফার ডাটা ---
const organizationPrograms = {
    'dawah': {
        title: 'দাওয়াত',
        icon: 'fa-bullhorn',
        color: '#00b366',
        description: 'তরুণ ছাত্রসমাজের কাছে ইসলামের আহবান পৌঁছিয়ে তাদের মাঝে ইসলামী জ্ঞানার্জন এবং বাস্তব জীবনে ইসলামের পূর্ণ অনুশীলনের দায়িত্বানুভূতি জাগ্রত করা।',
        details: [
            'ব্যক্তিগত সাক্ষাৎকার ও সম্প্রীতি স্থাপন। ',
            ' সাপ্তাহিক ও মাসিক সাধারণ সভা। ',
            ' সিম্পোজিয়াম, সেমিনার। ',
            ' চা-চক্র, বনভোজন। ',
            'নবাগত সংবর্ধনা। ', 
            ' বিতর্ক সভা, রচনা এবং বক্তৃতা প্রতিযোগিতা ও সাধারণ জ্ঞানের আসর। ',
            'পোস্টারিং, দেয়াল লিখন, পরিচিতি ও বিভিন্ন সময়ে প্রকাশিত সাময়িকী বিতরণ। ',
            'সিডি, ভিসিডি বিতরণ।', 
        
        ]
    },
    'organization': {
        title: 'সংগঠন',
        icon: 'fa-users-cog',
        color: '#34d399',
        description: 'যেসব ছাত্র ইসলামী জীবন বিধান প্রতিষ্ঠার সংগ্রামে অংশ নিতে প্রস্তুত, তাদেরকে সংগঠনের অধীনে সংঘবদ্ধ করা।',
        details: [
          'কর্মী বৈঠক',
          'সাথী বৈঠক', 
          'সদস্য বৈঠক',
          'দায়িত্বশীল বৈঠক',
          'কর্মী যোগাযোগ',
          'বায়তুলমাল',
          'সাংগঠনিক সফর',
          'পরিচালক নির্বাচন',
          'পরিকল্পনা',
          'রিপোর্টিং' , 
        ]
    },
    'training': {
        title: 'প্রশিক্ষণ',
        icon: 'fa-book-reader',
        color: '#60a5fa',
        description: 'এই সংগঠনের অধীনে সংঘবদ্ধ ছাত্রদেরকে ইসলামী জ্ঞান প্রদান এবং আদর্শ চরিত্রবানরূপে গড়ে তুলে জাহেলিয়াতের সমস্ত চ্যালেঞ্জের মোকাবিলায় ইসলামের শ্রেষ্ঠত্ব প্রমাণ করার যোগ্যতাসম্পন্ন কর্মী হিসেবে গড়ার কার্যকরী ব্যবস্থা করা।',
        details: [
            'পাঠাগার প্রতিষ্ঠা', 
            'ইসলামী সাহিত্য পাঠ ও বিতরণ ', 
            'পাঠচক্র, আলোচনা চক্র, সামষ্টিক অধ্যয়ন',
            'শিক্ষাশিবির, শিক্ষাবৈঠক', 
            'স্পিকার্স ফোরাম ',
            'লেখকশিবির ', 
            'শববেদারি বা নৈশ ইবাদত ', 
            'সামষ্টিক ভোজ' ,
            'ব্যক্তিগত রিপোর্ট সংরক্ষণ',
            'দোয়া ও নফল ইবাদত',
            'এহতেসাব বা গঠনমূলক সমালোচনা', 
            'আত্মসমালোচনা',
            'কুরআন তালিম / কুরআন ক্লাস', 
        ]
    },
    'education': {
        title: 'ইসলামী শিক্ষা আন্দোলন ও ছাত্র সমস্যার সমাধান',
        icon: 'fa-graduation-cap',
        color: '#c084fc',
        description: 'আদর্শ নাগরিক তৈরীর উদ্দেশ্যে ইসলামী মূল্যবোধের ভিত্তিতে শিক্ষাব্যবস্থার পরিবর্তন সাধনের দাবিতে সংগ্রাম এবং ছাত্রসমাজের প্রকৃত সমস্যা সমাধানের সংগ্রামে নেতৃত্ব প্রদান।',
        details: [
           'ইসলামী শিক্ষাব্যবস্থা প্রতিষ্ঠার সংগ্রাম সম্পর্কে জানা ', 
           'ছাত্রসমাজের প্রকৃত সমস্যা সমাধানের সংগ্রামে নেতৃত্ব প্রদান',  
        ]
    },
    'society': {
        title: 'ইসলামী সমাজ বিনির্মাণ',
        icon: 'fa-mosque',
        color: '#f43f5e',
        description: 'অর্থনৈতিক শোষণ, রাজনৈতিক নিপীড়ন এবং সাংস্কৃতিক গোলামী হতে মানবতার মুক্তির জন্য ইসলামী সমাজ বিনির্মাণে সর্বাত্মক প্রচেষ্টা চালানো।',
        details: [
          'ক্যারিয়ার তৈরি [To Build Up Career]', 
          'নেতৃত্ব তৈরি [To Make Up Leadership',
          'কর্মী তৈরি [To Build Worker]',
          'জ্ঞান অর্জন [To Acquire Knowledge]', 
        ]
    }
};

app.get('/program', (req, res) => {
    res.render('program-overview', { programs: organizationPrograms });
});

app.get('/program/:id', (req, res) => {
    const programId = req.params.id;
    const program = organizationPrograms[programId];
    if (!program) return res.status(404).send('প্রোগ্রাম পাওয়া যায়নি');
    res.render('program', { program });
});

// --- Access Control হেল্পার ফাংশন ---
const canViewAccess = (visibility, userType) => {
    const v = visibility || 'পাবলিক';
    if (v === 'পাবলিক') return true;
    if (!userType) return false;
    if (userType === 'admin') return true;
    if (v === 'কর্মী' && userType === 'কর্মী') return true;
    if (v === 'সাথী' && userType === 'সাথী') return true;
    return false;
};

// --- ৫. রুটস (Routes) ---

app.get('/', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const notices = await Notice.find().sort({ _id: -1 }).limit(5);
        const filteredNotices = notices.filter(n => canViewAccess(n.visibility, userType));
        const resources = await Resource.find().sort({ _id: -1 }).limit(5);
        const filteredResources = resources.filter(r => canViewAccess(r.visibility, userType));
        const slides = await Slide.find().sort({ createdAt: -1 }).limit(5);
        res.render('index', { notices: filteredNotices, resources: filteredResources, slides });
    } catch (err) { res.status(500).send("Home Page Error"); }
});

app.get('/notices', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const notices = await Notice.find().sort({ _id: -1 });
        const filteredNotices = notices.filter(n => canViewAccess(n.visibility, userType));
        res.render('notices', { notices: filteredNotices });
    } catch (err) { res.status(500).send("Notices Page Error"); }
});

app.get('/api/notices/latest', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const recentNotices = await Notice.find().sort({ _id: -1 }).limit(30);
        const latestVisibleNotice = recentNotices.find(n => canViewAccess(n.visibility, userType));

        res.set('Cache-Control', 'no-store');

        if (!latestVisibleNotice) {
            return res.json({ ok: true, notice: null });
        }

        return res.json({
            ok: true,
            notice: {
                id: String(latestVisibleNotice._id),
                title: latestVisibleNotice.title || 'নতুন নোটিশ',
                content: latestVisibleNotice.content || '',
                date: latestVisibleNotice.date || '',
                url: `/notice/${latestVisibleNotice._id}`
            }
        });
    } catch (err) {
        return res.status(500).json({ ok: false, message: 'Latest notice fetch failed' });
    }
});

app.get('/login-page', (req, res) => res.render('login-page', { error: null }));

app.post('/login', async (req, res) => {
    const phoneRaw = String(req.body.phone ?? '').trim();
    const password = String(req.body.password ?? '');
    const loginAndRedirect = (user, url) => new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);
            req.session.user = user;
            req.session.save((err2) => {
                if (err2) return reject(err2);
                return resolve(url);
            });
        });
    });

   // ১. এনভায়রনমেন্ট ভেরিয়েবল থেকে সরাসরি পাসওয়ার্ড রিড করা
const adminStored = process.env.ADMIN_PASSWORD; 
const allowDevAdminFallback = !IS_PROD && !adminStored;

if (phoneRaw.toLowerCase() === 'admin') {
    
    if (IS_PROD && !adminStored) {
        return res.render('login-page', { error: 'ADMIN_PASSWORD সেট করা নেই (Server Environment Variables)।' });
    }

    const ok = adminStored 
        ? safeTimingEqual(password, adminStored) 
        : (allowDevAdminFallback && safeTimingEqual(password, 'admin'));

    if (!ok) {
        return res.render('login-page', { error: 'ভুল অ্যাডমিন পাসওয়ার্ড!' });
    }

    try {
        const url = await loginAndRedirect({ role: 'admin', name: 'অ্যাডমিন' }, '/admin');
        return res.redirect(url);
    } catch (e) {
        console.error(e);
        return res.status(500).render('login-page', { error: 'লগইনে সমস্যা হয়েছে।' });
    }
}

    if (!phoneRaw) return res.render('login-page', { error: 'ফোন নম্বর দিন।' });

    const phoneCandidates = Array.from(new Set([
        phoneRaw,
        phoneRaw.replace(/\s+/g, ''),
        phoneRaw.replace(/[^\d+]/g, '')
    ].filter(Boolean)));

    try {
        let member = null;
        for (const candidate of phoneCandidates) {
            member = await Member.findOne({ phone: candidate });
            if (member) break;
        }
        if (member && verifyPassword(password, member.password)) {
            if (!String(member.password || '').startsWith(PASSWORD_HASH_PREFIX)) {
                member.password = hashPassword(password);
                await member.save();
            }
            const url = await loginAndRedirect({ id: member._id, role: member.type, name: member.name, type: 'member' }, '/');
            return res.redirect(url);
        }
        let supporter = null;
        for (const candidate of phoneCandidates) {
            supporter = await Supporter.findOne({ phone: candidate });
            if (supporter) break;
        }
        if (supporter && verifyPassword(password, supporter.password)) {
            if (!String(supporter.password || '').startsWith(PASSWORD_HASH_PREFIX)) {
                supporter.password = hashPassword(password);
                await supporter.save();
            }
            const url = await loginAndRedirect({ id: supporter._id, role: 'শুভাকাঙ্ক্ষী', name: supporter.name, type: 'supporter' }, '/');
            return res.redirect(url);
        }
    } catch (err) { console.error(err); }
    await new Promise(r => setTimeout(r, 150));
    res.render('login-page', { error: "ভুল ফোন নম্বর বা পাসওয়ার্ড!" });
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/logout', (_req, res) => res.status(405).send('Method Not Allowed'));

app.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const members = await Member.find();
        const notices = await Notice.find().sort({ _id: -1 });
        const resources = await Resource.find();
        const slides = await Slide.find().sort({ createdAt: -1 });
        const archives = await ArchiveItem.find().sort({ createdAt: -1 });
        const historyItems = await HistoryItem.find().sort({ createdAt: -1 });
        const apps = await Application.find().sort({ _id: -1 });
        const supporters = await Supporter.find().sort({ createdAt: -1 });
        res.render('admin', { data: { members, notices, resources, slides, archives, historyItems, applications: apps, supporters } });
    } catch (err) { console.error(err); res.status(500).send("Admin Error: " + err.message); }
});

app.get('/form', (req, res) => res.render('form'));

app.post('/submit-form', async (req, res) => {
    try {
        const { name, phone, email, institution, class_year, roll, address, ward, branch, guardian_phone, note } = req.body;
        await Application.create({ name, phone, email, institution, class_year, roll, address, ward, branch, guardian_phone, note });
        res.redirect('/form');
    } catch (err) { console.error(err); res.status(500).send('ফরম জমা দিতে সমস্যা হয়েছে।'); }
});

app.get('/library', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const allResources = await Resource.find().sort({ _id: -1 });
        const resources = allResources.filter(r => canViewAccess(r.visibility, userType));
        res.render('library', { resources });
    } catch (err) { res.status(500).send('লাইব্রেরি দেখাতে সমস্যা হয়েছে।'); }
});

app.get('/archive', async (req, res) => {
    try {
        const items = await ArchiveItem.find().sort({ createdAt: -1 });
        res.render('archive', { items });
    } catch (err) { res.status(500).send('আর্কাইভ লোড করতে সমস্যা হয়েছে।'); }
});

app.get('/history', async (req, res) => {
    try {
        const histories = await HistoryItem.find({ category: 'history' }).sort({ createdAt: -1 });
        const officials = await HistoryItem.find({ category: 'officials' }).sort({ createdAt: -1 });
        const martyrs = await HistoryItem.find({ category: 'martyrs' }).sort({ createdAt: -1 });
        res.render('history', { officials, martyrs, histories });
    } catch (err) { res.status(500).send('ইতিহাস দেখাতে সমস্যা হয়েছে।'); }
});

// Backward-compatible links (keep nav/footer links working)
app.get('/about', (_req, res) => res.redirect('/form'));
app.get('/syllabus', (_req, res) => res.redirect('/library'));
app.get('/news', (_req, res) => res.redirect('/archive'));

app.get('/notice/:id', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const notice = await Notice.findById(req.params.id);
        if (!notice) return res.status(404).send('নোটিশ পাওয়া যায়নি');
        if (!canViewAccess(notice.visibility, userType)) {
            if (!req.session.user) return res.redirect('/login-page');
            return res.status(403).render('access-denied', { message: `এই নোটিশটি শুধুমাত্র "${notice.visibility}" সদস্যদের জন্য।` });
        }
        res.render('notice', { notice });
    } catch (err) { res.status(500).send('নোটিশ দেখাতে সমস্যা হয়েছে।'); }
});


app.post('/admin/add-slide', upload.single('image'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, caption, link } = req.body;
        const imageUrl = req.file ? req.file.path : '';
        await Slide.create({ title, caption, link, imageUrl });
        res.redirect('/admin');
    } catch (error) { res.status(500).send('Slide Save Error: ' + error.message); }
});

app.post('/admin/update-slide/:id', upload.single('image'), requireCsrfAfterMultipart, (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, caption } = req.body;
        let updateData = { title, caption };
        if (req.file) updateData.imageUrl = req.file.path;
        Slide.findByIdAndUpdate(req.params.id, updateData).then(() => res.redirect('/admin'));
    } catch (error) { res.status(500).send('Slide Update Error: ' + error.message); }
});

app.post('/admin/delete-slide/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await Slide.findByIdAndDelete(req.params.id); res.redirect('/admin'); }
    catch (err) { res.status(500).send('Error'); }
});
app.get('/admin/delete-slide/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/add-archive', upload.single('image'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, description, itemType, url } = req.body;
        const imageUrl = req.file ? req.file.path : (url || '');
        await ArchiveItem.create({ title, description, itemType, url: imageUrl });
        res.redirect('/admin');
    } catch (err) { res.status(500).send('Archive Save Error: ' + err.message); }
});

app.post('/admin/delete-archive/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await ArchiveItem.findByIdAndDelete(req.params.id); res.redirect('/admin'); }
    catch (err) { res.status(500).send('Error'); }
});
app.get('/admin/delete-archive/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/add-history', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { category, title, body, extra, role, tenure } = req.body;
        const imageUrl = req.file ? req.file.path : '';
        await HistoryItem.create({ category, title, body, extra, role, tenure, imageUrl });
        res.redirect('/admin');
    } catch (err) { res.status(500).send('History Save Error: ' + err.message); }
});

app.get('/admin/edit-history/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const item = await HistoryItem.findById(req.params.id);
        if (!item) return res.status(404).send('History item not found');
        res.render('edit-history', { item });
    } catch (err) { res.status(404).send('History item not found'); }
});

app.post('/admin/update-history/:id', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { category, title, body, extra, role, tenure, existingImageUrl } = req.body;
        const updateData = {
            category,
            title,
            body,
            extra,
            role,
            tenure,
            imageUrl: req.file ? req.file.path : (existingImageUrl || '')
        };
        await HistoryItem.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin');
    } catch (err) { res.status(500).send('History Update Error: ' + err.message); }
});

app.post('/admin/delete-history/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await HistoryItem.findByIdAndDelete(req.params.id); res.redirect('/admin'); }
    catch (err) { res.status(500).send('Error'); }
});
app.get('/admin/delete-history/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/add-member', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch, type, edu, edu_other, inst, inst_other, responsibility, comment, password, baitul_mal_amount } = req.body;
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;
        const photoUrl = req.file ? req.file.path : 'https://res.cloudinary.com/dz9ifigag/image/upload/v1/default.png';
        const payments = []; for (let i = 0; i < 12; i++) payments.push(req.body[`month_${i}`] === 'on');
        const newMember = new Member({
            name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch,
            type, edu: finalEdu, inst: finalInst, responsibility, comment, password: hashPassword(password), photo: photoUrl,
            baitul_mal_amount: parseFloat(baitul_mal_amount) || 0, baitul_mal_payment: payments
        });
        await newMember.save(); res.redirect('/admin');
    } catch (err) { res.status(500).send("Error: " + err.message); }
});

app.post('/admin/update-member/:id', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch, type, edu, edu_other, inst, inst_other, responsibility, comment, password, baitul_mal_amount } = req.body;
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;
        const payments = []; for (let i = 0; i < 12; i++) payments.push(req.body[`month_${i}`] === 'on');
	        let updateData = {
	            name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch,
	            type, edu: finalEdu, inst: finalInst, responsibility, comment,
	            baitul_mal_amount: parseFloat(baitul_mal_amount) || 0, baitul_mal_payment: payments
	        };
	        const passwordValue = String(password ?? '').trim();
	        if (passwordValue) updateData.password = hashPassword(passwordValue);
	        if (req.file) updateData.photo = req.file.path;
	        await Member.findByIdAndUpdate(req.params.id, updateData); res.redirect('/admin');
	    } catch (err) { res.send("Update Error: " + err.message); }
	});

app.get('/admin/edit-member/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const member = await Member.findById(req.params.id); res.render('edit-member', { member }); }
    catch (err) { res.status(404).send("Member not found"); }
});

app.get('/admin/edit-notice/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const notice = await Notice.findById(req.params.id); res.render('edit-notice', { notice }); }
    catch (err) { res.status(404).send("Notice not found"); }
});

app.post('/admin/update-notice/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const { title, content, visibility } = req.body; await Notice.findByIdAndUpdate(req.params.id, { title, content, visibility }); res.redirect('/admin'); }
    catch (err) { res.send("Notice Update Error"); }
});

app.get('/admin/edit-resource/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const resource = await Resource.findById(req.params.id); res.render('edit-resource', { resource }); }
    catch (err) { res.status(404).send("Resource not found"); }
});

app.post('/admin/update-resource/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const { title, visibility, url, imageUrl } = req.body; await Resource.findByIdAndUpdate(req.params.id, { title, visibility, url: url || "", imageUrl: imageUrl || "" }); res.redirect('/admin'); }
    catch (err) { res.send("Resource Update Error"); }
});

app.get('/admin/edit-archive/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const item = await ArchiveItem.findById(req.params.id); res.render('edit-archive', { item }); }
    catch (err) { res.status(404).send("Archive item not found"); }
});

app.post('/admin/update-archive/:id', upload.single('image'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, description, itemType, url } = req.body;
        let updateData = { title, description, itemType };
        if (req.file) updateData.url = req.file.path; else if (url) updateData.url = url;
        await ArchiveItem.findByIdAndUpdate(req.params.id, updateData); res.redirect('/admin');
    } catch (err) { res.send("Archive Update Error: " + err.message); }
});

app.post('/admin/update-baitul-mal/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const payments = []; for (let i = 0; i < 12; i++) payments.push(req.body[`month_${i}`] === 'on');
        await Member.findByIdAndUpdate(req.params.id, { baitul_mal_payment: payments });
        res.redirect('/admin/edit-member/' + req.params.id);
    } catch (err) { res.send('বায়তুলমাল আপডেট Error: ' + err.message); }
});

app.post('/admin/delete-member/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await Member.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});
app.get('/admin/delete-member/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/delete-notice/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await Notice.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});
app.get('/admin/delete-notice/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/delete-resource/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await Resource.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});
app.get('/admin/delete-resource/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/delete-app/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { await Application.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});
app.get('/admin/delete-app/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/admin/add-notice', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const { title, content, visibility } = req.body; await new Notice({ title, content, visibility }).save(); res.redirect('/admin'); }
    catch (err) { res.status(500).send("Notice Save Error: " + err.message); }
});

app.post('/admin/add-resource', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const { title, visibility, url, imageUrl } = req.body; await new Resource({ title, visibility, url, imageUrl }).save(); res.redirect('/admin'); }
    catch (err) { res.status(500).send("Resource Save Error: " + err.message); }
});

app.get('/profile', async (req, res) => {
    if (!req.session.user || req.session.user.role === 'admin') return res.redirect('/login-page');
    try {
        let user;
        if (req.session.user.type === 'supporter') {
            user = await Supporter.findById(req.session.user.id);
        } else {
            user = await Member.findById(req.session.user.id);
        }
        res.render('profile', { user, session: req.session.user });
    }
    catch (err) { res.status(500).send('প্রোফাইল দেখাতে সমস্যা হয়েছে।'); }
});

app.get('/edit-profile', async (req, res) => {
    if (!req.session.user || req.session.user.role === 'admin') return res.redirect('/login-page');
    try {
        let user;
        if (req.session.user.type === 'supporter') {
            user = await Supporter.findById(req.session.user.id);
        } else {
            user = await Member.findById(req.session.user.id);
        }
        res.render('edit-profile', { user, session: req.session.user });
    }
    catch (err) { res.status(500).send('প্রোফাইল এডিট পেজ দেখাতে সমস্যা হয়েছে।'); }
});

app.post('/admin/add-supporter', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, address, phone, profession, facebook, target_amount, password } = req.body;
        const photo = req.file ? req.file.path : "";
        const payments = [];
        for (let i = 0; i < 12; i++) {
            payments.push(req.body[`sup_month_${i}`] === 'on');
        }
        await Supporter.create({
            name, address, phone, profession, facebook, photo, password: hashPassword(password),
            target_amount: parseFloat(target_amount) || 0,
            payments
        });
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Supporter Save Error: " + err.message); }
});

app.get('/admin/edit-supporter/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const supporter = await Supporter.findById(req.params.id);
        res.render('edit-supporter', { supporter });
    } catch (err) { res.status(500).send("Error"); }
});

app.post('/admin/update-supporter/:id', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, address, phone, profession, facebook, target_amount, password } = req.body;
        const updateData = { name, address, phone, profession, facebook, target_amount };
        const passwordValue = String(password ?? '').trim();
        if (passwordValue) updateData.password = hashPassword(passwordValue);
        if (req.file) updateData.photo = req.file.path;
        await Supporter.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Update Error"); }
});

app.post('/admin/update-supporter-payment/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const payments = [];
        for (let i = 0; i < 12; i++) {
            payments.push(req.body[`month_${i}`] === 'on');
        }
        await Supporter.findByIdAndUpdate(req.params.id, { payments });
        res.redirect('/admin');
    } catch (err) { res.status(500).send('Supporter Payment Update Error: ' + err.message); }
});

app.post('/admin/delete-supporter/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        await Supporter.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Error deleting supporter"); }
});
app.get('/admin/delete-supporter/:id', (_req, res) => res.status(405).send('Method Not Allowed'));

app.post('/update-profile', upload.single('photo'), requireCsrfAfterMultipart, async (req, res) => {
    if (!req.session.user || req.session.user.role === 'admin') return res.redirect('/login-page');
    try {
        const { name, phone, facebook, present_address } = req.body;
        const updateData = { name, phone, facebook, present_address };
        if (req.file) updateData.photo = req.file.path;

        if (req.session.user.type === 'supporter') {
            await Supporter.findByIdAndUpdate(req.session.user.id, updateData);
        } else {
            const { father, mother, dob, guardian_phone, permanent_address, inst, edu } = req.body;
            Object.assign(updateData, { father, mother, dob, guardian_phone, permanent_address, inst, edu });
            await Member.findByIdAndUpdate(req.session.user.id, updateData);
        }
        res.redirect('/profile?updated=true');
    } catch (err) { res.status(500).send('প্রোফাইল আপডেট করতে সমস্যা হয়েছে। ' + err.message); }
});

app.use((err, req, res, next) => {
    if (!err) return next();
    if (res.headersSent) return next(err);

    let status = 500;
    if (err.name === 'MulterError') {
        status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    } else if (String(err.message || '').startsWith('Invalid file type')) {
        status = 400;
    }

    console.error(err);
    const message = IS_PROD ? 'সার্ভারে সমস্যা হয়েছে।' : `Error: ${err.message || 'Unknown error'}`;
    return res.status(status).send(message);
});

mongoose.set('sanitizeFilter', true);
mongoose.connect(MONGO_URI).then(() => console.log("MongoDB Connected!")).catch(err => console.log("DB Error:", err.message));

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server Running`));
}

module.exports = app;
