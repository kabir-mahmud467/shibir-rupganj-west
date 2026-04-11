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
    phone: String,            // নতুন ফিল্ড
    facebook: String,         // নতুন ফিল্ড
    present_address: String,  // নতুন ফিল্ড
    permanent_address: String, // নতুন ফিল্ড
    type: String, 
    edu: String,
    inst: String,
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
    title: String, visibility: String, url: String
}));

const Application = mongoose.model('Application', new mongoose.Schema({
    name: String, phone: String, institution: String, date: String
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

// --- ৫. রুটস (Routes) ---

app.get('/', async (req, res) => {
    try {
        const notices = await Notice.find().sort({ _id: -1 }).limit(5);
        const resources = await Resource.find().limit(5);
        res.render('index', { notices, resources });
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
        const apps = await Application.find();
        res.render('admin', { data: { members, notices, resources, applications: apps } });
    } catch (err) { res.status(500).send("Admin Error"); }
});

// --- মেম্বার অ্যাড (লজিক আপডেট) ---
app.post('/admin/add-member', upload.single('photo'), async (req, res) => {
    try {
        const { name, father, mother, dob, phone, facebook, present_address, permanent_address, type, edu, edu_other, inst, inst_other, responsibility, comment, password } = req.body;
        
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;
        const photoUrl = req.file ? req.file.path : 'https://res.cloudinary.com/dz9ifigag/image/upload/v1/default.png';

        const newMember = new Member({
            name, father, mother, dob, 
            phone, facebook, present_address, permanent_address, // নতুন ডেটা
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
    try {
        const { name, father, mother, dob, phone, facebook, present_address, permanent_address, type, edu, edu_other, inst, inst_other, responsibility, comment, password } = req.body;
        const finalEdu = edu === 'অন্যান্য' ? edu_other : edu;
        const finalInst = inst === 'অন্যান্য' ? inst_other : inst;

        let updateData = { 
            name, father, mother, dob, 
            phone, facebook, present_address, permanent_address, // নতুন ডেটা
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

app.post('/admin/update-resource/:id', upload.single('file'), async (req, res) => {
    try {
        const { title, visibility, external_url } = req.body;
        let updateData = { title, visibility, url: external_url };
        if (req.file) updateData.url = req.file.path;
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
app.post('/admin/add-resource', upload.single('file'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    try {
        const { title, visibility, external_url } = req.body;
        let fileUrl = external_url || ""; // যদি লিঙ্ক থাকে

        // যদি ফাইল আপলোড করা হয়, তবে ক্লাউডিনারি লিঙ্ক ব্যবহার হবে
        if (req.file) {
            fileUrl = req.file.path;
        }

        const newResource = new Resource({
            title,
            visibility,
            url: fileUrl
        });

        await newResource.save();
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Resource Save Error: " + err.message);
    }
});
// --- ৬. সার্ভার স্টার্ট ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.log("❌ DB Error:", err.message));

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 সার্ভার রানিং: http://localhost:${PORT}`));
}

module.exports = app;