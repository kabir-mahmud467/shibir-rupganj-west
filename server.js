const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();

// --- মিডলওয়্যার ও সেটিংস ---
app.set('view engine', 'ejs');
app.use(express.static('public')); 
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'))); 
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'rupanj-west-erp-2026',
    resave: true,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } 
}));

// --- ফাইল আপলোড কনফিগারেশন ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// --- ডাটাবেজ হ্যান্ডলিং (JSON ফাইল) ---
const DATA_FILE = './data.json';
const getData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = { 
            members: [], 
            resources: [], 
            notices: [], 
            adminProfile: { name: "অ্যাডমিন", password: "admin", photo: "default.png" } 
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};
const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// --- ১. পাবলিক রুটস ---

app.get('/', (req, res) => {
    const data = getData();
    const userRole = req.session.user ? req.session.user.role : 'পাবলিক';
    
    // রোল অনুযায়ী ফিল্টার
    const visibleNotices = data.notices.filter(n => n.visibility === 'পাবলিক' || userRole === 'admin' || n.visibility === userRole);
    const visibleResources = data.resources.filter(r => r.visibility === 'পাবলিক' || userRole === 'admin' || r.visibility === userRole);

    res.render('index', { user: req.session.user || null, resources: visibleResources, notices: visibleNotices });
});

app.get('/login-page', (req, res) => res.render('login-page', { error: null }));

app.post('/login', (req, res) => {
    const { password } = req.body;
    const data = getData();
    
    if (password === data.adminProfile.password) {
        req.session.user = { id: 'admin', role: 'admin', ...data.adminProfile };
        return res.redirect('/admin');
    }
    
    const member = data.members.find(m => m.password === password);
    if (member) {
        req.session.user = { id: member.id, role: member.type, ...member };
        return res.redirect('/');
    }
    res.render('login-page', { error: "ভুল পাসওয়ার্ড! সঠিক কোড দিন।" });
});

// --- ২. অ্যাডমিন প্যানেল ও জনশক্তি ম্যানেজমেন্ট ---

app.get('/admin', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login-page');
    res.render('admin', { data: getData(), user: req.session.user });
});

// জনশক্তি যোগ
app.post('/admin/add-member', upload.single('photo'), (req, res) => {
    const data = getData();
    const newMember = {
        id: Date.now(),
        ...req.body,
        photo: req.file ? req.file.filename : 'default.png'
    };
    data.members.push(newMember);
    saveData(data);
    res.redirect('/admin');
});

// জনশক্তি এডিট
app.get('/admin/edit-member/:id', (req, res) => {
    const member = getData().members.find(m => m.id == req.params.id);
    res.render('edit-member', { user: req.session.user, member });
});

app.post('/admin/update-member/:id', upload.single('photo'), (req, res) => {
    const data = getData();
    const index = data.members.findIndex(m => m.id == req.params.id);
    if (index !== -1) {
        const oldPhoto = data.members[index].photo;
        data.members[index] = { ...data.members[index], ...req.body };
        if (req.file) data.members[index].photo = req.file.filename;
        else data.members[index].photo = oldPhoto;
        saveData(data);
    }
    res.redirect('/admin');
});

// জনশক্তি ডিলিট
app.get('/admin/delete-member/:id', (req, res) => {
    const data = getData();
    data.members = data.members.filter(m => m.id != req.params.id);
    saveData(data);
    res.redirect('/admin');
});

// --- ৩. নোটিশ ম্যানেজমেন্ট ---

app.post('/admin/add-notice', (req, res) => {
    const data = getData();
    data.notices.push({ 
        id: Date.now(), 
        ...req.body, 
        date: new Date().toLocaleDateString('bn-BD') 
    });
    saveData(data);
    res.redirect('/admin');
});

app.get('/admin/edit-notice/:id', (req, res) => {
    const notice = getData().notices.find(n => n.id == req.params.id);
    res.render('edit-notice', { user: req.session.user, notice });
});

app.post('/admin/update-notice/:id', (req, res) => {
    const data = getData();
    const index = data.notices.findIndex(n => n.id == req.params.id);
    if (index !== -1) {
        data.notices[index] = { ...data.notices[index], ...req.body };
        saveData(data);
    }
    res.redirect('/admin');
});

app.get('/admin/delete-notice/:id', (req, res) => {
    const data = getData();
    data.notices = data.notices.filter(n => n.id != req.params.id);
    saveData(data);
    res.redirect('/admin');
});

// --- ৪. লাইব্রেরি/রিসোর্স ম্যানেজমেন্ট ---

app.post('/admin/add-resource', upload.single('file'), (req, res) => {
    const data = getData();
    data.resources.push({
        id: Date.now(), 
        ...req.body,
        url: req.file ? `/uploads/${req.file.filename}` : req.body.external_url
    });
    saveData(data);
    res.redirect('/admin');
});

app.get('/admin/edit-resource/:id', (req, res) => {
    const resource = getData().resources.find(r => r.id == req.params.id);
    res.render('edit-resource', { user: req.session.user, resource });
});

app.post('/admin/update-resource/:id', upload.single('file'), (req, res) => {
    const data = getData();
    const index = data.resources.findIndex(r => r.id == req.params.id);
    if (index !== -1) {
        const oldUrl = data.resources[index].url;
        data.resources[index] = { ...data.resources[index], ...req.body };
        if (req.file) data.resources[index].url = `/uploads/${req.file.filename}`;
        else data.resources[index].url = oldUrl;
        saveData(data);
    }
    res.redirect('/admin');
});

app.get('/admin/delete-resource/:id', (req, res) => {
    const data = getData();
    data.resources = data.resources.filter(r => r.id != req.params.id);
    saveData(data);
    res.redirect('/admin');
});

// --- ৫. এক্সেল/CSV ডাউনলোড ---

app.get('/admin/download-list', (req, res) => {
    const data = getData();
    let csv = "\ufeffনাম,পিতা,মাতা,জন্ম তারিখ,মান,শিক্ষা,প্রতিষ্ঠান,দায়িত্ব,অগ্রগতি,মন্তব্য\n";
    data.members.forEach(m => {
        const eduFinal = m.edu === 'অন্যান্য' ? m.edu_other : m.edu;
        const instFinal = m.inst === 'অন্যান্য' ? m.inst_other : m.inst;
        csv += `"${m.name}","${m.father}","${m.mother}","${m.dob}","${m.type}","${eduFinal}","${instFinal}","${m.responsibility}","${m.progress}","${m.comment}"\n`;
    });
    res.setHeader('Content-disposition', 'attachment; filename=jonoshokti_list.csv');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.send(csv);
});

// --- ৬. প্রোফাইল ও লগআউট ---

app.get('/profile', (req, res) => {
    if (!req.session.user) return res.redirect('/login-page');
    const data = getData();
    const profile = (req.session.user.role === 'admin') ? data.adminProfile : data.members.find(m => m.id == req.session.user.id);
    res.render('profile', { user: req.session.user, profile });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- সার্ভার স্টার্ট ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));