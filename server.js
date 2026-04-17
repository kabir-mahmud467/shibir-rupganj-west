require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
let MongoStore = require('connect-mongo');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

const app = express();

// --- ১. কনফিগারেশন ---
const MONGO_URI = process.env.MONGODB_URI;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- ২. ডাটাবেজ মডেল (Schema) ---

const MemberSchema = new mongoose.Schema({
    name: String, father: String, mother: String, dob: String, phone: String,
    guardian_phone: String, facebook: String, present_address: String,
    permanent_address: String, type: String, edu: String, inst: String,
    ward: String, branch: String, responsibility: String, comment: String,
    password: { type: String, unique: true }, photo: String,
    baitul_mal_amount: { type: Number, default: 0 },
    baitul_mal_payment: { type: [Boolean], default: () => Array(12).fill(false) }
});
const Member = mongoose.models.Member || mongoose.model('Member', MemberSchema);

const NoticeSchema = new mongoose.Schema({
    title: String, content: String, visibility: String,
    date: { type: String, default: () => new Date().toLocaleDateString('bn-BD') }
});
const Notice = mongoose.models.Notice || mongoose.model('Notice', NoticeSchema);

const ResourceSchema = new mongoose.Schema({
    title: String, visibility: String, url: String, imageUrl: String
});
const Resource = mongoose.models.Resource || mongoose.model('Resource', ResourceSchema);

const SlideSchema = new mongoose.Schema({
    title: String, caption: String, imageUrl: String, link: String,
    createdAt: { type: Date, default: Date.now }
});
const Slide = mongoose.models.Slide || mongoose.model('Slide', SlideSchema);

const ArchiveItemSchema = new mongoose.Schema({
    title: String, description: String, itemType: String, url: String,
    createdAt: { type: Date, default: Date.now }
});
const ArchiveItem = mongoose.models.ArchiveItem || mongoose.model('ArchiveItem', ArchiveItemSchema);

const HistoryItemSchema = new mongoose.Schema({
    category: String, title: String, body: String, extra: String,
    createdAt: { type: Date, default: Date.now }
});
const HistoryItem = mongoose.models.HistoryItem || mongoose.model('HistoryItem', HistoryItemSchema);


const ApplicationSchema = new mongoose.Schema({
    name: String, phone: String, email: String, institution: String,
    class_year: String, roll: String, address: String, ward: String,
    branch: String, guardian_phone: String, note: String,
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
const upload = multer({ storage: storage });

// --- ৪. মিডলওয়্যার ও সেশন ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

if (MongoStore.default) { MongoStore = MongoStore.default; }

app.use(session({
    secret: 'rupganj-west-secret-2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
        secure: false
    }
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Favicon fix
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- ৫ দফার ডাটা ---
const organizationPrograms = {
    'dawah': {
        title: 'দাওয়াত',
        icon: 'fa-bullhorn',
        color: '#00b366',
        description: 'তরুণ ছাত্রসমাজের কাছে ইসলামের আহবান পৌঁছিয়ে তাদের মাঝে ইসলামী জ্ঞানার্জন এবং বাস্তব জীবনে ইসলামের পূর্ণ অনুশীলনের দায়িত্বানুভূতি জাগ্রত করা।',
        details: [
            'তরুণ ছাত্রসমাজের নিকট ইসলামের সুমহান আহবান পৌঁছানো।',
            'ছাত্রদের মাঝে ইসলামী জ্ঞানার্জনের আগ্রহ সৃষ্টি করা।',
            'বাস্তব জীবনে ইসলাম পূর্ণ অনুশীলনের প্রেরণা জোগানো।',
            'দ্বীনি দায়িত্ব পালনে সচেতনতা বৃদ্ধি করা।'
        ]
    },
    'organization': {
        title: 'সংগঠন',
        icon: 'fa-users-cog',
        color: '#34d399',
        description: 'যেসব ছাত্র ইসলামী জীবন বিধান প্রতিষ্ঠার সংগ্রামে অংশ নিতে প্রস্তুত, তাদেরকে সংগঠনের অধীনে সংঘবদ্ধ করা।',
        details: [
            'আদর্শিক মিল থাকা ছাত্রদের একতাবদ্ধ করা।',
            'শৃঙ্খলার সাথে সাংগঠনিক কাঠামো শক্তিশালী করা।',
            'সামষ্টিক কাজের মাধ্যমে ভ্রাতৃত্ব উন্নয়ন।',
            'ইসলামী বিপ্লবের জন্য দক্ষ শক্তি তৈরি।'
        ]
    },
    'training': {
        title: 'প্রশিক্ষণ',
        icon: 'fa-book-reader',
        color: '#60a5fa',
        description: 'এই সংগঠনের অধীনে সংঘবদ্ধ ছাত্রদেরকে ইসলামী জ্ঞান প্রদান এবং আদর্শ চরিত্রবানরূপে গড়ে তুলে জাহেলিয়াতের সমস্ত চ্যালেঞ্জের মোকাবিলায় ইসলামের শ্রেষ্ঠত্ব প্রমাণ করার যোগ্যতাসম্পন্ন কর্মী হিসেবে গড়ার কার্যকরী ব্যবস্থা করা।',
        details: [
            'কুরআন ও হাদিসের গভীর জ্ঞান প্রদান।',
            'আদর্শ চরিত্র গঠন ও নৈতিক মান উন্নয়ন।',
            'জাহেলিয়াতের চ্যালেঞ্জ মোকাবিলায় বুদ্ধিবৃত্তিক প্রস্তুতি।',
            'ইসলামের শ্রেষ্ঠত্ব প্রমাণে দক্ষ কর্মী তৈরি।'
        ]
    },
    'education': {
        title: 'ইসলামী শিক্ষা আন্দোলন ও ছাত্র সমস্যার সমাধান',
        icon: 'fa-graduation-cap',
        color: '#c084fc',
        description: 'আদর্শ নাগরিক তৈরীর উদ্দেশ্যে ইসলামী মূল্যবোধের ভিত্তিতে শিক্ষাব্যবস্থার পরিবর্তন সাধনের দাবিতে সংগ্রাম এবং ছাত্রসমাজের প্রকৃত সমস্যা সমাধানের সংগ্রামে নেতৃত্ব প্রদান।',
        details: [
            'ইসলামী মূল্যবোধ সম্পন্ন শিক্ষাব্যবস্থা চালুর সংগ্রাম।',
            'আদর্শ নাগরিক তৈরির উপযোগী কারিকুলাম দাবি।',
            'ছাত্রদের ন্যায্য ও মৌলিক দাবি আদায়ে নেতৃত্ব।'
        ]
    },
    'society': {
        title: 'ইসলামী সমাজ বিনির্মাণ',
        icon: 'fa-mosque',
        color: '#f43f5e',
        description: 'অর্থনৈতিক শোষণ, রাজনৈতিক নিপীড়ন এবং সাংস্কৃতিক গোলামী হতে মানবতার মুক্তির জন্য ইসলামী সমাজ বিনির্মাণে সর্বাত্মক প্রচেষ্টা চালানো।',
        details: [
            'অর্থনৈতিক শোষণ থেকে মানবতার মুক্তির লড়াই।',
            'political নিপীড়ন ও বৈষম্যের বিরুদ্ধে জনমত।',
            'সাংস্কৃতিক গোলামী মুক্ত সুস্থ সংস্কৃতি বিকাশ।',
            'ইনসাফ ভিত্তিক সমাজ প্রতিষ্ঠায় সর্বোচ্চ ত্যাগ।'
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

app.get('/login-page', (req, res) => res.render('login-page', { error: null }));

app.post('/login', async (req, res) => {
    const { password } = req.body;
    if (password === "admin") {
        req.session.user = { role: 'admin', name: 'অ্যাডমিন' };
        return req.session.save(() => res.redirect('/admin'));
    }
    try {
        const member = await Member.findOne({ password });
        if (member) {
            req.session.user = { id: member._id, role: member.type, name: member.name, type: 'member' };
            return req.session.save(() => res.redirect('/'));
        }
        const supporter = await Supporter.findOne({ password });
        if (supporter) {
            req.session.user = { id: supporter._id, role: 'শুভাকাঙ্ক্ষী', name: supporter.name, type: 'supporter' };
            return req.session.save(() => res.redirect('/'));
        }
    } catch (err) { console.error(err); }
    res.render('login-page', { error: "ভুল পাসওয়ার্ড!" });
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

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


app.post('/admin/add-slide', upload.single('image'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, caption, link } = req.body;
        const imageUrl = req.file ? req.file.path : '';
        await Slide.create({ title, caption, link, imageUrl });
        res.redirect('/admin');
    } catch (error) { res.status(500).send('Slide Save Error: ' + error.message); }
});

app.post('/admin/update-slide/:id', upload.single('image'), (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, caption } = req.body;
        let updateData = { title, caption };
        if (req.file) updateData.imageUrl = req.file.path;
        Slide.findByIdAndUpdate(req.params.id, updateData).then(() => res.redirect('/admin'));
    } catch (error) { res.status(500).send('Slide Update Error: ' + error.message); }
});

app.get('/admin/delete-slide/:id', async (req, res) => {
    try { await Slide.findByIdAndDelete(req.params.id); res.redirect('/admin'); }
    catch (err) { res.status(500).send('Error'); }
});

app.post('/admin/add-archive', upload.single('image'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, description, itemType, url } = req.body;
        const imageUrl = req.file ? req.file.path : (url || '');
        await ArchiveItem.create({ title, description, itemType, url: imageUrl });
        res.redirect('/admin');
    } catch (err) { res.status(500).send('Archive Save Error: ' + err.message); }
});

app.get('/admin/delete-archive/:id', async (req, res) => {
    try { await ArchiveItem.findByIdAndDelete(req.params.id); res.redirect('/admin'); }
    catch (err) { res.status(500).send('Error'); }
});

app.post('/admin/add-history', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { category, title, body, extra } = req.body;
        await HistoryItem.create({ category, title, body, extra });
        res.redirect('/admin');
    } catch (err) { res.status(500).send('History Save Error: ' + err.message); }
});

app.get('/admin/delete-history/:id', async (req, res) => {
    try { await HistoryItem.findByIdAndDelete(req.params.id); res.redirect('/admin'); }
    catch (err) { res.status(500).send('Error'); }
});

app.post('/admin/add-member', upload.single('photo'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch, type, edu, edu_other, inst, inst_other, responsibility, comment, password, baitul_mal_amount } = req.body;
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;
        const photoUrl = req.file ? req.file.path : 'https://res.cloudinary.com/dz9ifigag/image/upload/v1/default.png';
        const payments = []; for (let i = 0; i < 12; i++) payments.push(req.body[`month_${i}`] === 'on');
        const newMember = new Member({
            name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch,
            type, edu: finalEdu, inst: finalInst, responsibility, comment, password, photo: photoUrl,
            baitul_mal_amount: parseFloat(baitul_mal_amount) || 0, baitul_mal_payment: payments
        });
        await newMember.save(); res.redirect('/admin');
    } catch (err) { res.status(500).send("Error: " + err.message); }
});

app.post('/admin/update-member/:id', upload.single('photo'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch, type, edu, edu_other, inst, inst_other, responsibility, comment, password, baitul_mal_amount } = req.body;
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;
        const payments = []; for (let i = 0; i < 12; i++) payments.push(req.body[`month_${i}`] === 'on');
        let updateData = {
            name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch,
            type, edu: finalEdu, inst: finalInst, responsibility, comment, password,
            baitul_mal_amount: parseFloat(baitul_mal_amount) || 0, baitul_mal_payment: payments
        };
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
    try { const { title, content, visibility } = req.body; await Notice.findByIdAndUpdate(req.params.id, { title, content, visibility }); res.redirect('/admin'); }
    catch (err) { res.send("Notice Update Error"); }
});

app.get('/admin/edit-resource/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const resource = await Resource.findById(req.params.id); res.render('edit-resource', { resource }); }
    catch (err) { res.status(404).send("Resource not found"); }
});

app.post('/admin/update-resource/:id', async (req, res) => {
    try { const { title, visibility, url, imageUrl } = req.body; await Resource.findByIdAndUpdate(req.params.id, { title, visibility, url: url || "", imageUrl: imageUrl || "" }); res.redirect('/admin'); }
    catch (err) { res.send("Resource Update Error"); }
});

app.get('/admin/edit-archive/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try { const item = await ArchiveItem.findById(req.params.id); res.render('edit-archive', { item }); }
    catch (err) { res.status(404).send("Archive item not found"); }
});

app.post('/admin/update-archive/:id', upload.single('image'), async (req, res) => {
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

app.get('/admin/delete-member/:id', async (req, res) => {
    try { await Member.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});

app.get('/admin/delete-notice/:id', async (req, res) => {
    try { await Notice.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});

app.get('/admin/delete-resource/:id', async (req, res) => {
    try { await Resource.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});

app.get('/admin/delete-app/:id', async (req, res) => {
    try { await Application.findByIdAndDelete(req.params.id); res.redirect('/admin'); } catch (err) { res.status(500).send("Error"); }
});

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

app.post('/admin/add-supporter', upload.single('photo'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, address, phone, profession, facebook, target_amount, password } = req.body;
        const photo = req.file ? req.file.path : "";
        const payments = [];
        for (let i = 0; i < 12; i++) {
            payments.push(req.body[`sup_month_${i}`] === 'on');
        }
        await Supporter.create({
            name, address, phone, profession, facebook, photo, password,
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

app.post('/admin/update-supporter/:id', upload.single('photo'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, address, phone, profession, facebook, target_amount, password } = req.body;
        const updateData = { name, address, phone, profession, facebook, target_amount, password };
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

app.get('/admin/delete-supporter/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        await Supporter.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Error deleting supporter"); }
});

app.post('/update-profile', upload.single('photo'), async (req, res) => {
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

mongoose.connect(MONGO_URI).then(() => console.log("MongoDB Connected!")).catch(err => console.log("DB Error:", err.message));

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server Running`));
}

module.exports = app;