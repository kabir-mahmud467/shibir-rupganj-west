const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();

// ১. সেটিংস ও মিডলওয়্যার
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'shibir-final-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // ২৪ ঘণ্টা
}));

// ২. ফাইল আপলোড কনফিগারেশন
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// ৩. ডাটাবেজ ফাংশন (JSON)
const DATA_FILE = './data.json';
const getData = () => {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const initial = { notices: [], files: [], members: [], adminProfile: { name: "অ্যাডমিন", password: "admin", photo: "default.png" } };
            fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return { notices: [], files: [], members: [], adminProfile: { name: "অ্যাডমিন", password: "admin", photo: "default.png" } };
    }
};
const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// ৪. রুটস (Routes)

// হোমপেজ
app.get('/', (req, res) => {
    const data = getData();
    const role = req.session.role || 'public';
    let myProfile = null;
    if (req.session.role === 'admin') myProfile = data.adminProfile;
    else if (req.session.userId) myProfile = data.members.find(m => m.id == req.session.userId);

    const notices = (data.notices || []).filter(n => n.target === 'public' || n.target === role || role === 'admin');
    res.render('index', { role, profile: myProfile, notices });
});

// লগইন পেজ
app.get('/login-page', (req, res) => {
    if (req.session.role) return res.redirect('/profile');
    const error = req.session.loginError;
    delete req.session.loginError; // একবার দেখানোর পর মুছে ফেলুন
    res.render('login-page', { error });
});

// লগইন প্রসেস
app.post('/login', (req, res) => {
    const { password } = req.body;
    const data = getData();
    
    // অ্যাডমিন চেক
    if (password === data.adminProfile.password) {
        req.session.role = 'admin';
        return res.redirect('/profile');
    }
    
    // মেম্বার চেক
    const member = data.members.find(m => m.password === password);
    if (member) {
        req.session.role = member.type;
        req.session.userId = member.id;
        return res.redirect('/profile');
    }

    // ভুল পাসওয়ার্ড
    req.session.loginError = "ভুল পাসওয়ার্ড! আবার চেষ্টা করুন।";
    res.redirect('/login-page');
});

// প্রোফাইল পেজ
app.get('/profile', (req, res) => {
    if (!req.session.role) return res.redirect('/login-page');
    const data = getData();
    let myProfile = (req.session.role === 'admin') ? data.adminProfile : data.members.find(m => m.id == req.session.userId);
    
    if (!myProfile) return res.redirect('/logout');
    res.render('profile', { profile: myProfile, role: req.session.role });
});

// অ্যাডমিন প্রোফাইল আপডেট
app.post('/admin/update-profile', upload.single('photo'), (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/');
    const data = getData();
    data.adminProfile.name = req.body.name;
    data.adminProfile.password = req.body.password;
    if (req.file) data.adminProfile.photo = req.file.filename;
    saveData(data);
    res.redirect('/profile');
});

// অ্যাডমিন প্যানেল
app.get('/admin', (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/');
    res.render('admin', { data: getData() });
});

// মেম্বার যোগ
app.post('/admin/add-member', upload.single('photo'), (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/');
    const data = getData();
    data.members.push({ id: Date.now(), ...req.body, photo: req.file ? req.file.filename : 'default.png' });
    saveData(data);
    res.redirect('/admin');
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.listen(3000, () => console.log('সার্ভার রানিং: http://localhost:3000'));