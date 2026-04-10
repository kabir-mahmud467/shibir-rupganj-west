const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
let MongoStore = require('connect-mongo');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

const app = express();

// --- ১. কনফিগারেশন ও ডাটাবেজ লিঙ্ক ---
const MONGO_URI = "mongodb://kabirmahmud467_db_user:shibir@ac-l2lby6j-shard-00-00.4y2um2c.mongodb.net:27017,ac-l2lby6j-shard-00-01.4y2um2c.mongodb.net:27017,ac-l2lby6j-shard-00-02.4y2um2c.mongodb.net:27017/RupganjWestDB?ssl=true&replicaSet=atlas-90vaxd-shard-0&authSource=admin&appName=ShibirRupganjWest";

cloudinary.config({
    cloud_name: 'dz9ifigag',
    api_key: '267649947248973',
    api_secret: 'W5H4x6zC_UqL8u5tS9vX9_m4X0k' 
});

// --- ২. ডাটাবেজ মডেল (Schema) ---
const Member = mongoose.model('Member', new mongoose.Schema({
    name: String,
    type: String,            // ড্রপডাউন: সদস্য/সাথী/কর্মী
    responsibility: String,  // ড্রপডাউন: সভাপতি/সম্পাদক ইত্যাদি
    progress: String,        // ড্রপডাউন: চলমান/উন্নত
    password: { type: String, unique: true },
    photo: String
}));

const Notice = mongoose.model('Notice', new mongoose.Schema({ 
    title: String, content: String, date: String 
}));

const Resource = mongoose.model('Resource', new mongoose.Schema({
    title: String, visibility: String, url: String
}));

const Application = mongoose.model('Application', new mongoose.Schema({
    name: String, phone: String, address: String, date: String
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
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

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
    } catch (err) { res.status(500).send("Home Page Error"); }
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
        // আপনার admin.ejs ফাইলে 'data' অবজেক্টের চাহিদা অনুযায়ী পাঠানো হলো
        res.render('admin', { data: { members, notices, resources, applications: apps } });
    } catch (err) { res.status(500).send("Admin Error"); }
});

// জনশক্তি/মেম্বার অ্যাড রুট (Fixed for all fields)
app.post('/admin/add-member', upload.single('photo'), async (req, res) => {
    try {
        const { name, type, responsibility, progress, password } = req.body;

        const newMember = new Member({
            name,
            type,
            responsibility,
            progress,
            password,
            photo: req.file ? req.file.path : 'https://res.cloudinary.com/dz9ifigag/image/upload/v1/default.png'
        });

        await newMember.save();
        res.redirect('/admin');
    } catch (err) {
        if (err.code === 11000) {
            return res.send("<script>alert('পাসওয়ার্ডটি ইতিমধ্যে ব্যবহৃত! অন্যটি দিন।'); window.history.back();</script>");
        }
        res.status(500).send("Error: " + err.message);
    }
});

// আবেদন জমা দেওয়া
app.post('/submit-form', async (req, res) => {
    try {
        await new Application({ ...req.body, date: new Date().toLocaleString('bn-BD') }).save();
        res.send("<script>alert('আবেদন সফল হয়েছে!'); window.location.href='/';</script>");
    } catch (err) { res.status(500).send("Form Submission Failed"); }
});

// --- ৬. মঙ্গোডিবি কানেকশন এবং এক্সপোর্ট ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.log("❌ DB Error:", err.message));

// লোকাল হোস্টে চালানোর জন্য
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 সার্ভার রানিং: http://localhost:${PORT}`);
    });
}

// ভার্সেল ডিপ্লয়মেন্টের জন্য জরুরি
module.exports = app;

// ক্রাশ ঠেকানোর গ্লোবাল হ্যান্ডলার
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});