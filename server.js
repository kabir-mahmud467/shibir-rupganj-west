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
const MONGO_URI = "mongodb://kabirmahmud467_db_user:shibir@ac-l2lby6j-shard-00-00.4y2um2c.mongodb.net:27017,ac-l2lby6j-shard-00-01.4y2um2c.mongodb.net:27017,ac-l2lby6j-shard-00-02.4y2um2c.mongodb.net:27017/RupganjWestDB?ssl=true&replicaSet=atlas-90vaxd-shard-0&authSource=admin&appName=ShibirRupganjWest";

cloudinary.config({
    cloud_name: 'dz9ifigag',
    api_key: '267649947248973',
    api_secret: 'W5H4x6zC_UqL8u5tS9vX9_m4X0k' 
});

// --- ২. ডাটাবেজ মডেল (Schema) ---
const Member = mongoose.model('Member', new mongoose.Schema({
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
    photo: String
}));

const Notice = mongoose.model('Notice', new mongoose.Schema({ 
    title: String, 
    content: String, 
    visibility: String, 
    date: { type: String, default: () => new Date().toLocaleDateString('bn-BD') }
}));

const Resource = mongoose.model('Resource', new mongoose.Schema({
    title: String, visibility: String, url: String, imageUrl: String
}));

const Slide = mongoose.model('Slide', new mongoose.Schema({
    title: String,
    caption: String,
    imageUrl: String,
    link: String,
    createdAt: { type: Date, default: Date.now }
}));

const ArchiveItem = mongoose.model('ArchiveItem', new mongoose.Schema({
    title: String,
    description: String,
    itemType: String,
    url: String,
    createdAt: { type: Date, default: Date.now }
}));

const HistoryItem = mongoose.model('HistoryItem', new mongoose.Schema({
    category: String,
    title: String,
    body: String,
    extra: String,
    createdAt: { type: Date, default: Date.now }
}));

const HomeStat = mongoose.model('HomeStat', new mongoose.Schema({
    value: String,
    label: String,
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}));

const Application = mongoose.model('Application', new mongoose.Schema({
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
}));

// --- ৩. ক্লাউডিনারি আপলোড সেটিংস ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'rupganj_west',
        allowed_formats: ['jpg', 'png', 'jpeg', 'pdf']
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

// --- Access Control হেল্পার ফাংশন ---
const canViewAccess = (visibility, userType) => {
    if (visibility === 'পাবলিক') return true;
    if (!userType) return false;
    if (visibility === 'কর্মী' && userType === 'কর্মী') return true;
    if (visibility === 'সাথী' && userType === 'সাথী') return true;
    return false;
};

// --- ৫. রুটস (Routes) ---

app.get('/', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        
        // নোটিস ফিল্টার করা
        let noticeQuery = Notice.find().sort({ _id: -1 }).limit(5);
        const notices = await noticeQuery;
        const filteredNotices = notices.filter(n => canViewAccess(n.visibility, userType));
        
        // রিসোর্স ফিল্টার করা
        let resourceQuery = Resource.find().sort({ _id: -1 }).limit(5);
        const resources = await resourceQuery;
        const filteredResources = resources.filter(r => canViewAccess(r.visibility, userType));
        
        const slides = await Slide.find().sort({ createdAt: -1 }).limit(5);
        const homeStats = await HomeStat.find().sort({ order: 1, createdAt: -1 }).limit(4);
        res.render('index', { notices: filteredNotices, resources: filteredResources, slides, homeStats });
    } catch (err) { 
        res.status(500).send("Home Page Error"); 
    }
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
            req.session.user = { id: member._id, role: member.type, name: member.name };
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
        const homeStats = await HomeStat.find().sort({ order: 1, createdAt: -1 });
        const apps = await Application.find().sort({ _id: -1 });
        res.render('admin', { data: { members, notices, resources, slides, archives, historyItems, homeStats, applications: apps } });
    } catch (err) { res.status(500).send("Admin Error"); }
});

app.get('/form', (req, res) => res.render('form'));

app.post('/submit-form', async (req, res) => {
    try {
        const {
            name,
            phone,
            email,
            institution,
            class_year,
            roll,
            address,
            ward,
            branch,
            guardian_phone,
            note
        } = req.body;

        await Application.create({
            name,
            phone,
            email,
            institution,
            class_year,
            roll,
            address,
            ward,
            branch,
            guardian_phone,
            note
        });

        res.redirect('/form');
    } catch (err) {
        console.error(err);
        res.status(500).send('ফরম জমা দিতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    }
});

app.get('/library', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const allResources = await Resource.find().sort({ _id: -1 });
        const resources = allResources.filter(r => canViewAccess(r.visibility, userType));
        res.render('library', { resources });
    } catch (err) {
        res.status(500).send('লাইব্রেরি দেখাতে সমস্যা হয়েছে।');
    }
});

app.get('/archive', async (req, res) => {
    try {
        const items = await ArchiveItem.find().sort({ createdAt: -1 });
        res.render('archive', { items });
    } catch (err) {
        res.status(500).send('আর্কাইভ লোড করতে সমস্যা হয়েছে।');
    }
});

app.get('/history', async (req, res) => {
    try {
        const histories = await HistoryItem.find({ category: 'history' }).sort({ createdAt: -1 });
        const officials = await HistoryItem.find({ category: 'officials' }).sort({ createdAt: -1 });
        const martyrs = await HistoryItem.find({ category: 'martyrs' }).sort({ createdAt: -1 });
        res.render('history', { officials, martyrs, histories });
    } catch (err) {
        res.status(500).send('ইতিহাস দেখাতে সমস্যা হয়েছে।');
    }
});

app.get('/notice/:id', async (req, res) => {
    try {
        const userType = req.session.user?.role;
        const notice = await Notice.findById(req.params.id);
        if (!notice) return res.status(404).send('নোটিশ পাওয়া যায়নি');
        
        // Visibility চেক
        if (!canViewAccess(notice.visibility, userType)) {
            return res.status(403).send('এই নোটিশ দেখার অনুমতি আপনার নেই।');
        }
        
        res.render('notice', { notice });
    } catch (err) {
        res.status(500).send('নোটিশ দেখাতে সমস্যা হয়েছে।');
    }
});

app.post('/admin/add-home-stat', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { value, label } = req.body;
        await HomeStat.create({ value, label });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Home Stat Save Error: ' + err.message);
    }
});

app.get('/admin/delete-home-stat/:id', async (req, res) => {
    try {
        await HomeStat.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Error');
    }
});

app.post('/admin/add-slide', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, caption, imageUrl, link } = req.body;
        await Slide.create({ title, caption, imageUrl, link });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Slide Save Error: ' + err.message);
    }
});

app.get('/admin/delete-slide/:id', async (req, res) => {
    try {
        await Slide.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Error');
    }
});

app.post('/admin/add-archive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, description, itemType, url } = req.body;
        await ArchiveItem.create({ title, description, itemType, url });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Archive Save Error: ' + err.message);
    }
});

app.get('/admin/delete-archive/:id', async (req, res) => {
    try {
        await ArchiveItem.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Error');
    }
});

app.post('/admin/add-history', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { category, title, body, extra } = req.body;
        await HistoryItem.create({ category, title, body, extra });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('History Save Error: ' + err.message);
    }
});

app.get('/admin/delete-history/:id', async (req, res) => {
    try {
        await HistoryItem.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send('Error');
    }
});

// --- মেম্বার অ্যাড (লজিক আপডেট) ---
app.post('/admin/add-member', upload.single('photo'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch, type, edu, edu_other, inst, inst_other, responsibility, comment, password } = req.body;
        
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;
        const photoUrl = req.file ? req.file.path : 'https://res.cloudinary.com/dz9ifigag/image/upload/v1/default.png';

        const newMember = new Member({
            name, father, mother, dob,
            phone, guardian_phone, facebook, present_address, permanent_address,
            ward, branch,
            type, edu: finalEdu, inst: finalInst,
            responsibility, comment, password, photo: photoUrl
        });

        await newMember.save();
        res.redirect('/admin');
    } catch (err) {
        if (err.code === 11000) return res.send("<script>alert('পাসওয়ার্ডটি ইতিমধ্যে ব্যবহৃত!'); window.history.back();</script>");
        res.status(500).send("Error: " + err.message);
    }
});

// --- মেম্বার আপডেট (লজিক আপডেট) ---
app.post('/admin/update-member/:id', upload.single('photo'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, ward, branch, type, edu, edu_other, inst, inst_other, responsibility, comment, password } = req.body;
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;

        let updateData = {
            name, father, mother, dob,
            phone, guardian_phone, facebook, present_address, permanent_address,
            ward, branch,
            type, edu: finalEdu, inst: finalInst,
            responsibility, comment, password
        };
        
        if (req.file) updateData.photo = req.file.path;

        await Member.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin');
    } catch (err) { res.send("Update Error: " + err.message); }
});

// --- এডিট পেজ রুটস ---
app.get('/admin/edit-member/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const member = await Member.findById(req.params.id);
        res.render('edit-member', { member });
    } catch (err) { res.status(404).send("Member not found"); }
});

app.get('/admin/edit-notice/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const notice = await Notice.findById(req.params.id);
        res.render('edit-notice', { notice });
    } catch (err) { res.status(404).send("Notice not found"); }
});

app.post('/admin/update-notice/:id', async (req, res) => {
    try {
        const { title, content, visibility } = req.body;
        await Notice.findByIdAndUpdate(req.params.id, { title, content, visibility });
        res.redirect('/admin');
    } catch (err) { res.send("Notice Update Error"); }
});

app.get('/admin/edit-resource/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const resource = await Resource.findById(req.params.id);
        res.render('edit-resource', { resource });
    } catch (err) { res.status(404).send("Resource not found"); }
});

app.post('/admin/update-resource/:id', async (req, res) => {
    try {
        const { title, visibility, url, imageUrl } = req.body;
        const updateData = { title, visibility, url: url || "", imageUrl: imageUrl || "" };
        await Resource.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin');
    } catch (err) { res.send("Resource Update Error"); }
});

// --- ডিলিট রুটস ---
app.get('/admin/delete-member/:id', async (req, res) => {
    try {
        await Member.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/admin/delete-notice/:id', async (req, res) => {
    try {
        await Notice.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/admin/delete-resource/:id', async (req, res) => {
    try {
        await Resource.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/admin/delete-app/:id', async (req, res) => {
    try {
        await Application.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) { res.status(500).send("Error"); }
});
// --- নতুন নোটিশ যোগ করার রুট ---
app.post('/admin/add-notice', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, content, visibility } = req.body;
        const newNotice = new Notice({ title, content, visibility });
        await newNotice.save();
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Notice Save Error: " + err.message);
    }
});

// --- লাইব্রেরি ফাইল (Resource) যোগ করার রুট ---
app.post('/admin/add-resource', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, visibility, url, imageUrl } = req.body;

        const newResource = new Resource({
            title,
            visibility,
            url: url || "",
            imageUrl: imageUrl || ""
        });

        await newResource.save();
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Resource Save Error: " + err.message);
    }
});
// --- ৬. সার্ভার স্টার্ট ---
// --- প্রোফাইল ম্যানেজমেন্ট ---
app.get('/profile', async (req, res) => {
    if (!req.session.user || req.session.user.role === 'admin') return res.redirect('/login-page');
    try {
        const member = await Member.findById(req.session.user.id);
        if (!member) return res.status(404).send('প্রোফাইল পাওয়া যায়নি।');
        res.render('profile', { member });
    } catch (err) {
        res.status(500).send('প্রোফাইল দেখাতে সমস্যা হয়েছে।');
    }
});

app.get('/edit-profile', async (req, res) => {
    if (!req.session.user || req.session.user.role === 'admin') return res.redirect('/login-page');
    try {
        const member = await Member.findById(req.session.user.id);
        if (!member) return res.status(404).send('প্রোফাইল পাওয়া যায়নি।');
        res.render('edit-profile', { member });
    } catch (err) {
        res.status(500).send('প্রোফাইল এডিট পেজ দেখাতে সমস্যা হয়েছে।');
    }
});

app.post('/update-profile', async (req, res) => {
    if (!req.session.user || req.session.user.role === 'admin') return res.redirect('/login-page');
    try {
        const { name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, inst, edu } = req.body;
        
        const updateData = {
            name, father, mother, dob, phone, guardian_phone, facebook, present_address, permanent_address, inst, edu
        };
        
        await Member.findByIdAndUpdate(req.session.user.id, updateData);
        res.redirect('/profile?updated=true');
    } catch (err) {
        res.status(500).send('প্রোফাইল আপডেট করতে সমস্যা হয়েছে।');
    }
});

// --- MongoDB সংযোগ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.log("❌ DB Error:", err.message));

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 সার্ভার রানিং: http://localhost:${PORT}`));
}

module.exports = app;