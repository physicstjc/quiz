
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, doc, getDoc, deleteDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

// App State
let currentUser = null;
let userRole = null; // 'teacher' or 'student'

// Navigation and Layout elements
const navbar = document.getElementById('navbar');
const views = {
    login: document.getElementById('view-login'),
    student: document.getElementById('view-student'),
    teacher: document.getElementById('view-teacher'),
    quizBuilder: document.getElementById('view-quiz-builder'),
    quizRoom: document.getElementById('view-quiz-room'),
    teacherResults: document.getElementById('view-teacher-results'),
    attemptDetail: document.getElementById('view-attempt-detail'),
    manageStudents: document.getElementById('view-manage-students')
};
const exitPreviewBtn = document.getElementById('exit-preview-btn');

// UI Components
const navUserName = document.getElementById('nav-user-name');
const navUserEmail = document.getElementById('nav-user-email');
const userRoleBadge = document.getElementById('user-role-badge');
const logoutBtn = document.getElementById('logout-btn');
const errorMessage = document.getElementById('error-message');
const loginGoogleBtn = document.getElementById('login-google-btn');

// Show View helper
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    
    // Manage Navbar visibility
    if (viewName === 'login') {
        navbar.classList.add('hidden');
    } else {
        navbar.classList.remove('hidden');
    }
}

// Authentication Logic
onAuthStateChanged(auth, (user) => {
    console.log("Auth state changed:", user);
    if (user) {
        const email = user.email;
        console.log("Logged in with email:", email);
        if (email.endsWith('@moe.edu.sg')) {
            userRole = 'teacher';
            userRoleBadge.innerText = 'TEACHER';
            userRoleBadge.classList.replace('bg-blue-100', 'bg-purple-100');
            userRoleBadge.classList.replace('text-blue-700', 'text-purple-700');
        } else if (email.endsWith('@students.edu.sg')) {
            userRole = 'student';
            userRoleBadge.innerText = 'STUDENT';
            userRoleBadge.classList.replace('bg-purple-100', 'bg-blue-100');
            userRoleBadge.classList.replace('text-purple-700', 'text-blue-700');
        } else {
            // Unauthorized domain
            signOut(auth);
            showError("Your email domain is not authorized. Use @moe.edu.sg or @students.edu.sg.");
            return;
        }

        currentUser = user;
        navUserName.innerText = user.displayName;
        navUserEmail.innerText = email;
        userRoleBadge.classList.remove('invisible');

        // Check if user is in prepopulated list to use their full name
        const emailLower = email.toLowerCase();
        getDoc(doc(db, "students", emailLower)).then(studentDoc => {
            console.log("Checking student name for:", emailLower);
            if (studentDoc.exists()) {
                console.log("Found student name:", studentDoc.data().name);
                navUserName.innerText = studentDoc.data().name;
            } else {
                console.log("Student not found in list, using Google name.");
            }
        });
        
        if (userRole === 'teacher') {
            showView('teacher');
            refreshTeacherDashboard();
        } else {
            showView('student');
            refreshStudentDashboard();

            // Auto-join quiz if code is in URL
            const urlParams = new URLSearchParams(window.location.search);
            const quizCode = urlParams.get('code');
            if (quizCode) {
                console.log("Auto-joining quiz with code:", quizCode);
                joinQuizBtn.disabled = true;
                joinQuizBtn.innerText = "JOINING...";
                
                const q = query(collection(db, "quizzes"), where("quizCode", "==", quizCode.toUpperCase()));
                getDocs(q).then(snap => {
                    if (!snap.empty) {
                        const docSnap = snap.docs[0];
                        // Clear the URL parameter so it doesn't re-trigger on refresh
                        const newUrl = window.location.origin + window.location.pathname;
                        window.history.replaceState({}, document.title, newUrl);
                        startQuiz(docSnap.id, docSnap.data());
                    }
                }).finally(() => {
                    joinQuizBtn.disabled = false;
                    joinQuizBtn.innerText = "JOIN";
                });
            }
        }
    } else {
        currentUser = null;
        userRole = null;
        showView('login');
    }
});

function showError(msg) {
    errorMessage.innerText = msg;
    errorMessage.classList.remove('hidden');
}

loginGoogleBtn.onclick = () => {
    signInWithPopup(auth, googleProvider).catch(err => showError(err.message));
};

logoutBtn.onclick = () => {
    signOut(auth);
};

// ----------------------------------------------------
// TEACHER DASHBOARD LOGIC
// ----------------------------------------------------
let qrcodeInstance = null;

function showShareModal(code) {
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?code=${code}`;
    
    document.getElementById('share-url-input').value = shareUrl;
    document.getElementById('share-code-display').innerText = code || '------';
    
    // Generate QR Code
    const qrContainer = document.getElementById('share-qrcode');
    qrContainer.innerHTML = ""; // Clear existing
    
    if (code) {
        new QRCode(qrContainer, {
            text: shareUrl,
            width: 140,
            height: 140,
            colorDark: "#1d4ed8", // blue-700
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    document.getElementById('modal-share-quiz').classList.remove('hidden');
}

document.getElementById('close-share-modal').onclick = () => {
    document.getElementById('modal-share-quiz').classList.add('hidden');
};

// Also close on background click
document.getElementById('modal-share-quiz').onclick = (e) => {
    if (e.target.id === 'modal-share-quiz') {
        document.getElementById('modal-share-quiz').classList.add('hidden');
    }
};
const addQuizBtn = document.getElementById('add-quiz-btn');
const manageStudentsBtn = document.getElementById('manage-students-btn');
const teacherQuizList = document.getElementById('teacher-quiz-list');
const backToTeacher = document.getElementById('back-to-teacher');
const backToTeacherFromStudents = document.getElementById('back-to-teacher-from-students');
const studentListContainer = document.getElementById('student-list-container');
const studentCsvInput = document.getElementById('student-csv-input');
const uploadCsvBtn = document.getElementById('upload-csv-btn');
const studentClassFilter = document.getElementById('student-class-filter');
const studentSearchInput = document.getElementById('student-search-input');
const bulkActionsBar = document.getElementById('bulk-actions-bar');
const selectedCountText = document.getElementById('selected-count');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');
const selectAllCheckbox = document.getElementById('select-all-students');

let selectedStudentEmails = new Set();

manageStudentsBtn.onclick = () => {
    selectedStudentEmails.clear();
    bulkActionsBar.classList.add('hidden');
    selectAllCheckbox.checked = false;
    showView('manageStudents');
    refreshStudentList();
};

studentClassFilter.onchange = () => refreshStudentList();
studentSearchInput.oninput = () => refreshStudentList();

selectAllCheckbox.onchange = (e) => {
    const checkboxes = studentListContainer.querySelectorAll('.student-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        if (e.target.checked) selectedStudentEmails.add(cb.dataset.email);
        else selectedStudentEmails.delete(cb.dataset.email);
    });
    updateBulkActionsBar();
};

deleteSelectedBtn.onclick = async () => {
    const count = selectedStudentEmails.size;
    if (confirm(`Are you sure you want to delete ${count} selected students?`)) {
        deleteSelectedBtn.disabled = true;
        deleteSelectedBtn.innerText = "Deleting...";
        try {
            const promises = Array.from(selectedStudentEmails).map(email => deleteDoc(doc(db, "students", email)));
            await Promise.all(promises);
            selectedStudentEmails.clear();
            updateBulkActionsBar();
            refreshStudentList();
            selectAllCheckbox.checked = false;
        } catch (err) {
            alert("Error deleting students: " + err.message);
        } finally {
            deleteSelectedBtn.disabled = false;
            deleteSelectedBtn.innerHTML = `<ion-icon name="trash"></ion-icon> Delete Selected`;
        }
    }
};

function updateBulkActionsBar() {
    const count = selectedStudentEmails.size;
    if (count > 0) {
        bulkActionsBar.classList.remove('hidden');
        selectedCountText.innerText = `${count} Students Selected`;
    } else {
        bulkActionsBar.classList.add('hidden');
    }
}

window.toggleStudentSelection = (email, checked) => {
    if (checked) selectedStudentEmails.add(email);
    else selectedStudentEmails.delete(email);
    updateBulkActionsBar();
};

backToTeacherFromStudents.onclick = () => showView('teacher');

uploadCsvBtn.onclick = () => studentCsvInput.click();

studentCsvInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const text = event.target.result;
        const lines = text.split('\n');
        let count = 0;

        for (const line of lines) {
            const rawParts = line.split(',').map(p => p.trim());
            let email = "", className = "";

            // Identify email and class
            const emailIdx = rawParts.findIndex(p => p.includes('@'));
            
            if (emailIdx !== -1) {
                email = rawParts[emailIdx].replace(/"/g, '').trim().toLowerCase();
                // Everything else is treated as the class (usually just one field after email)
                className = rawParts.slice(emailIdx + 1).join(', ').replace(/"/g, '').trim();
                
                if (email) {
                    // Extract name from email: adeline_tang_ying_qi@... -> Adeline Tang Ying Qi
                    const namePart = email.split('@')[0];
                    const name = namePart.split('_')
                                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                        .join(' ');

                    try {
                        await setDoc(doc(db, "students", email), {
                            email: email,
                            name: name,
                            class: className,
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                        count++;
                    } catch (err) {
                        console.error("Error saving student:", email, err);
                    }
                }
            }
        }
        alert(`Successfully imported ${count} students!`);
        refreshStudentList();
        studentCsvInput.value = "";
    };
    reader.readAsText(file);
};

async function refreshStudentList() {
    studentListContainer.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-gray-400">Loading students...</td></tr>`;
    try {
        const snap = await getDocs(collection(db, "students"));
        studentListContainer.innerHTML = "";
        
        const selectedClass = studentClassFilter.value;
        const searchQuery = studentSearchInput.value.toLowerCase().trim();

        // Update class filter options dynamically
        const classes = new Set();
        snap.forEach(d => {
            const s = d.data();
            if (s.class) classes.add(s.class);
        });

        const currentFilterOptions = Array.from(studentClassFilter.options).map(o => o.value);
        classes.forEach(c => {
            if (!currentFilterOptions.includes(c)) {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                studentClassFilter.appendChild(opt);
            }
        });

        const students = [];
        snap.forEach(d => {
            const s = d.data();
            const matchesClass = selectedClass === "all" || s.class === selectedClass;
            const matchesSearch = !searchQuery || 
                                 s.name.toLowerCase().includes(searchQuery) || 
                                 s.email.toLowerCase().includes(searchQuery);

            if (matchesClass && matchesSearch) {
                students.push(s);
            }
        });

        if (students.length === 0) {
            studentListContainer.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-gray-400 italic">No matching students found.</td></tr>`;
            return;
        }

        // Sort by class then name
        students.sort((a, b) => {
            if (a.class !== b.class) return a.class.localeCompare(b.class);
            return a.name.localeCompare(b.name);
        });

        students.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-5 w-12 text-center">
                    <input type="checkbox" class="student-checkbox w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" data-email="${s.email}" onchange="toggleStudentSelection('${s.email}', this.checked)">
                </td>
                <td class="p-5 font-bold text-gray-800">${s.name}</td>
                <td class="p-5 text-gray-500 font-mono text-sm">${s.email}</td>
                <td class="p-5"><span class="bg-indigo-100 text-indigo-700 font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-widest">${s.class}</span></td>
                <td class="p-5 text-right">
                    <button class="text-red-400 hover:text-red-600 font-bold" onclick="deleteStudent('${s.email}')"><ion-icon name="close-circle"></ion-icon></button>
                </td>
            `;
            studentListContainer.appendChild(row);
        });
    } catch (err) {
        studentListContainer.innerHTML = `<tr><td colspan="4" class="p-5 text-red-500 font-bold">Error: ${err.message}</td></tr>`;
    }
}

window.deleteStudent = async (email) => {
    if (confirm(`Delete student ${email}?`)) {
        await deleteDoc(doc(db, "students", email));
        refreshStudentList();
    }
};

const quizTitleInput = document.getElementById('quiz-title-input');
const quizDescInput = document.getElementById('quiz-desc-input');
const questionsContainer = document.getElementById('questions-container');
const addQuestionBtn = document.getElementById('add-question-btn');
const saveQuizBtn = document.getElementById('save-quiz-btn');

let currentQuizQuestions = [];
let editingQuizId = null;

async function refreshTeacherDashboard() {
    console.log("Refreshing Teacher Dashboard...");
    teacherQuizList.innerHTML = `<div class="p-10 text-gray-400 font-bold">Loading quizzes...</div>`;
    try {
        const q = query(collection(db, "quizzes"), where("teacherId", "==", currentUser.uid), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        teacherQuizList.innerHTML = "";
        if (snap.empty) {
            teacherQuizList.innerHTML = `<div class="p-10 text-gray-400 font-medium">No quizzes created yet. Start by clicking "Create New Quiz".</div>`;
            return;
        }

            snap.forEach(docSnap => {
                const quiz = docSnap.data();
                const card = document.createElement('div');
                card.className = "group bg-white p-8 rounded-2xl shadow-sm border hover:shadow-xl hover:border-blue-400 hover:-translate-y-1 transition-all flex flex-col justify-between cursor-pointer";
                
                // Clicking the card area itself triggers the Share Share Modal
                card.onclick = (e) => {
                    const btnActions = e.target.closest('button');
                    if (!btnActions) {
                        showShareModal(quiz.quizCode);
                    }
                };

                card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start mb-4">
                        <h3 class="text-xl font-black tracking-tight leading-tight group-hover:text-blue-600 transition-colors">${quiz.title}</h3>
                        <div class="bg-indigo-50 text-indigo-700 font-mono font-bold text-xs px-2 py-1 rounded border border-indigo-100 uppercase tracking-widest">${quiz.quizCode || 'NO CODE'}</div>
                    </div>
                    <p class="text-sm text-gray-500 mb-6 italic line-clamp-2">${quiz.description || "No description."}</p>
                    <div class="text-[10px] bg-gray-100 text-gray-500 font-bold px-2 py-1 rounded inline-block uppercase mb-6 tracking-widest">${quiz.questions.length} Questions</div>
                </div>
                <div class="flex gap-2">
                    <button class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center font-black" title="Preview Quiz" onclick="previewQuiz('${docSnap.id}')">
                        <ion-icon name="eye"></ion-icon>
                    </button>
                    <button class="bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center font-black" title="Edit Quiz" onclick="editQuiz('${docSnap.id}')">
                        <ion-icon name="create-outline"></ion-icon>
                    </button>
                    <button class="flex-grow bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 font-black" onclick="viewResults('${docSnap.id}')">
                        <ion-icon name="stats-chart"></ion-icon> Results
                    </button>
                    <button class="bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center font-black" onclick="confirmDeleteQuiz('${docSnap.id}', '${quiz.title.replace(/'/g, "\\'")}')">
                        <ion-icon name="trash"></ion-icon>
                    </button>
                </div>
            `;
                teacherQuizList.appendChild(card);
            });
    } catch (error) {
        console.error("Full Error:", error);
        if (error.code === 'failed-precondition') {
            teacherQuizList.innerHTML = `
                <div class="p-10 text-amber-600 bg-amber-50 rounded-xl border border-amber-200">
                    <h3 class="font-bold mb-2">Index Required</h3>
                    <p class="text-sm mb-4">Firebase needs an index to show your quizzes. Check your browser console for a link to fix this automatically.</p>
                </div>`;
        } else {
            teacherQuizList.innerHTML = `<div class="p-10 text-red-500 font-bold">Error loading quizzes: ${error.message}</div>`;
        }
    }
}

addQuizBtn.onclick = () => {
    editingQuizId = null;
    showView('quizBuilder');
    resetQuizBuilder();
};

window.editQuiz = async (quizId) => {
    editingQuizId = quizId;
    const qDoc = await getDoc(doc(db, "quizzes", quizId));
    if (!qDoc.exists()) return alert("Quiz not found");
    
    const quiz = qDoc.data();
    showView('quizBuilder');
    
    quizTitleInput.value = quiz.title;
    quizDescInput.value = quiz.description || "";
    questionsContainer.innerHTML = "";
    // Create a NEW copy of the questions array to avoid reference issues
    currentQuizQuestions = JSON.parse(JSON.stringify(quiz.questions || []));

    currentQuizQuestions.forEach((q, idx) => {
        renderQuestionBlock(q, idx);
    });
};

backToTeacher.onclick = () => showView('teacher');

function resetQuizBuilder() {
    quizTitleInput.value = "";
    quizDescInput.value = "";
    questionsContainer.innerHTML = "";
    currentQuizQuestions = [];
    addQuestionToBuilder(); // Add one by default
}

function addQuestionToBuilder() {
    const qId = Date.now();
    const q = { id: qId, text: "", options: ["", "", "", ""], optionImages: [null, null, null, null], correctAnswer: 0, image: null, explanation: "" };
    currentQuizQuestions.push(q);
    renderQuestionBlock(q, currentQuizQuestions.length - 1);
}

// Function to handle image uploads for Quill
async function handleQuillImageUpload(quill, qId) {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;

        try {
            const range = quill.getSelection(true);
            const storagePath = `quiz-content/${currentUser.uid}/${qId}-${Date.now()}`;
            const fileRef = ref(storage, storagePath);
            const snapshot = await uploadBytes(fileRef, file);
            const url = await getDownloadURL(snapshot.ref);
            
            quill.insertEmbed(range.index, 'image', url);
            quill.setSelection(range.index + 1);
        } catch (error) {
            console.error("Quill image upload failed:", error);
            alert("Failed to upload image. Please try again.");
        }
    };
}

// Function to handle all image uploads (quill or options)
window.uploadImage = async (qId, file, type, extra) => {
    if (!file) return;
    try {
        const storagePath = `quiz-content/${currentUser.uid}/${qId}-${Date.now()}`;
        const fileRef = ref(storage, storagePath);
        const snapshot = await uploadBytes(fileRef, file);
        const url = await getDownloadURL(snapshot.ref);
        
        if (type === 'optionImage') {
            window.updateOptionImage(qId, extra, url);
        }
    } catch (err) {
        alert("Upload failed: " + err.message);
    }
};

function renderQuestionBlock(q, qIndex) {
    const qBlock = document.createElement('div');
    qBlock.className = "q-block bg-white border-2 border-indigo-50 p-8 rounded-3xl mb-8 transition-all hover:border-indigo-100 hover:shadow-xl hover:shadow-indigo-50/50 group relative";
    
    // Ensure optionImages exists for old quizzes being edited
    if (!q.optionImages) q.optionImages = [null, null, null, null];

    const editorId = `editor-${q.id}`;
    qBlock.innerHTML = `
        <!-- Floating Question Number Badge -->
        <div class="absolute -top-4 -left-4 w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black text-xl shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform">
           ${currentQuizQuestions.indexOf(q) + 1}
        </div>

        <div class="flex justify-between items-start mb-8 ml-6">
            <h3 class="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <ion-icon name="help-circle" class="text-lg"></ion-icon>
                Question Details
            </h3>
            <button onclick="removeQuestion('${q.id}')" class="text-red-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-xl transition-all flex items-center gap-2 text-xs font-bold">
                <ion-icon name="trash-outline" class="text-lg"></ion-icon>
                Remove
            </button>
        </div>

        <div class="space-y-8 ml-6">
            <div>
                <label class="block text-xs font-bold text-indigo-500 uppercase tracking-widest mb-3">Question Content</label>
                <!-- Container for Quill Editor -->
                <div class="border-2 border-indigo-50 rounded-2xl overflow-hidden focus-within:border-indigo-400 transition-colors">
                    <div id="${editorId}" class="quill-editor h-64 bg-white"></div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                ${[0, 1, 2, 3].map(i => `
                    <div class="bg-indigo-50/30 p-6 rounded-2xl border border-transparent hover:border-indigo-100 transition-all">
                        <div class="flex items-center justify-between mb-4">
                            <label class="flex items-center gap-3 cursor-pointer">
                                <input type="radio" name="correct-${q.id}" ${q.correctAnswer === i ? 'checked' : ''} 
                                       onchange="window.updateQ('${q.id}', 'correctAnswer', ${i})" 
                                       class="w-5 h-5 text-indigo-600 border-2 border-indigo-200 focus:ring-indigo-500">
                                <span class="text-xs font-bold text-indigo-400 uppercase tracking-wider">Option ${String.fromCharCode(65 + i)}</span>
                            </label>
                            
                            <!-- Option Image Upload -->
                            <div class="flex items-center gap-2">
                                <label class="cursor-pointer text-indigo-500 hover:text-indigo-700 bg-white p-2 rounded-lg shadow-sm border border-indigo-50 transition-all flex items-center gap-2 text-[10px] font-bold">
                                    <ion-icon name="image-outline"></ion-icon>
                                    ${q.optionImages[i] ? 'Change Image' : 'Add Image'}
                                    <input type="file" class="hidden" accept="image/*" onchange="window.uploadImage('${q.id}', this.files[0], 'optionImage', ${i})">
                                </label>
                                ${q.optionImages[i] ? `
                                    <button onclick="window.updateOptionImage('${q.id}', ${i}, null); this.closest('.bg-indigo-50/30').querySelector('.opt-img-container').innerHTML = '';" class="text-red-400 hover:text-red-600 p-2">
                                        <ion-icon name="close-circle-outline"></ion-icon>
                                    </button>
                                ` : ''}
                            </div>
                        </div>

                        <div class="opt-img-container">
                            ${q.optionImages[i] ? `
                                <div class="mb-4 rounded-xl overflow-hidden border-2 border-white shadow-sm h-32 w-full bg-white flex items-center justify-center">
                                    <img src="${q.optionImages[i]}" class="max-h-full object-contain">
                                </div>
                            ` : ''}
                        </div>

                        <input type="text" class="w-full bg-white border-2 border-indigo-50 p-4 rounded-xl outline-none focus:border-indigo-400 transition-all text-gray-700 font-medium placeholder:text-gray-300" 
                               value="${q.options[i]}" placeholder="Type option text..." 
                               oninput="window.updateOption('${q.id}', ${i}, this.value)">
                    </div>
                `).join('')}
            </div>

            <div>
                <label class="block text-xs font-bold text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <ion-icon name="bulb-outline"></ion-icon>
                    Solution Explanation (Optional)
                </label>
                <textarea class="w-full bg-white border-2 border-indigo-50 p-6 rounded-2xl outline-none focus:border-indigo-400 transition-all italic text-gray-600 placeholder:text-gray-300 min-h-[100px]" 
                          placeholder="Why is this the correct answer?" 
                          oninput="window.updateQ('${q.id}', 'explanation', this.value)">${q.explanation || ""}</textarea>
            </div>
        </div>
    `;
    questionsContainer.appendChild(qBlock);

    // Initialize Quill for this specific question
    const quill = new Quill(`#${editorId}`, {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['link', 'image'],
                ['clean']
            ]
        },
        placeholder: 'Write your question here...'
    });

    // Load initial content if editing
    if (q.text) {
        quill.root.innerHTML = q.text;
    }

    // Custom image handler for Quill to upload to Firebase instead of base64
    quill.getModule('toolbar').addHandler('image', () => {
        handleQuillImageUpload(quill, q.id);
    });

    // Sync content to state
    quill.on('text-change', () => {
        // Use root.innerHTML to get the rich text content
        window.updateQ(q.id, 'text', quill.root.innerHTML);
    });
}

window.removeQuestion = (id) => {
    currentQuizQuestions = currentQuizQuestions.filter(q => q.id !== id);
    const blocks = questionsContainer.querySelectorAll('.q-block');
    questionsContainer.removeChild(blocks[Array.from(blocks).findIndex(b => b.innerHTML.includes(id))]);
};

window.updateQ = (id, key, val) => {
    const q = currentQuizQuestions.find(q => q.id == id);
    if (q) q[key] = val;
};

window.updateOptionImage = (id, optIdx, val) => {
    const q = currentQuizQuestions.find(q => q.id == id); // Use weak equality check (==) in case id is string vs number
    if (q) {
        if (!q.optionImages) q.optionImages = [null, null, null, null];
        q.optionImages[optIdx] = val;
        
        // Find and update preview
        const blocks = questionsContainer.querySelectorAll('.q-block');
        // Find the block that contains this specific question ID
        const block = Array.from(blocks).find(b => b.innerHTML.includes(`name="correct-${id}"`) || b.innerHTML.includes(`'${id}'`));
        if (block) {
            const container = block.querySelectorAll('.opt-img-container')[optIdx];
            if (val) {
                container.innerHTML = `
                    <div class="mb-4 rounded-xl overflow-hidden border-2 border-white shadow-sm h-32 w-full bg-white flex items-center justify-center">
                        <img src="${val}" class="max-h-full object-contain">
                    </div>
                `;
            } else {
                container.innerHTML = '';
            }
        }
    }
};

window.updateOption = (id, optIdx, val) => {
    const q = currentQuizQuestions.find(q => q.id == id);
    if (q) q.options[optIdx] = val;
};

window.uploadImage = async (qId, file, type, extra) => {
    if (!file) return;
    try {
        const storagePath = `quiz-content/${currentUser.uid}/${qId}-${Date.now()}`;
        const fileRef = ref(storage, storagePath);
        const snapshot = await uploadBytes(fileRef, file);
        const url = await getDownloadURL(snapshot.ref);
        
        if (type === 'optionImage') {
            window.updateOptionImage(qId, extra, url);
        }
    } catch (err) {
        alert("Upload failed: " + err.message);
    }
};

addQuestionBtn.onclick = addQuestionToBuilder;

saveQuizBtn.onclick = async () => {
    const title = quizTitleInput.value;
    if (!title) return alert("Please enter a title");
    
    saveQuizBtn.disabled = true;
    saveQuizBtn.innerText = "Saving...";

    try {
        if (editingQuizId) {
            // Update existing quiz
            await updateDoc(doc(db, "quizzes", editingQuizId), {
                title: title,
                description: quizDescInput.value,
                questions: currentQuizQuestions,
                updatedAt: serverTimestamp()
            });
            alert("Quiz updated successfully!");
        } else {
            // Create new quiz
            const quizCode = Math.random().toString(36).substring(2, 6).toUpperCase();
            await addDoc(collection(db, "quizzes"), {
                title: title,
                description: quizDescInput.value,
                teacherId: currentUser.uid,
                teacherEmail: currentUser.email,
                quizCode: quizCode,
                questions: currentQuizQuestions,
                createdAt: serverTimestamp()
            });
            alert("New quiz created!");
        }
        showView('teacher');
        refreshTeacherDashboard();
    } catch (err) {
        alert(err.message);
    } finally {
        saveQuizBtn.disabled = false;
        saveQuizBtn.innerHTML = `<ion-icon name="save-outline" size="large"></ion-icon> Save Quiz`;
        editingQuizId = null;
    }
};

// ----------------------------------------------------
// QUIZ DELETION LOGIC
// ----------------------------------------------------
window.confirmDeleteQuiz = async (quizId, quizTitle) => {
    if (confirm(`Are you sure you want to delete "${quizTitle}"? This will permanently remove the quiz and all associated results.`)) {
        try {
            await deleteDoc(doc(db, "quizzes", quizId));
            
            // Cleanup attempts for this quiz
            const attemptsQuery = query(collection(db, "quiz_attempts"), where("quizId", "==", quizId));
            const attemptsSnap = await getDocs(attemptsQuery);
            const deletePromises = attemptsSnap.docs.map(d => deleteDoc(doc(db, "quiz_attempts", d.id)));
            await Promise.all(deletePromises);

            refreshTeacherDashboard();
        } catch (error) {
            console.error("Error deleting quiz:", error);
            alert("Error deleting quiz: " + error.message);
        }
    }
};

// ----------------------------------------------------
// TEACHER RESULTS LOGIC
// ----------------------------------------------------
let currentResultsQuizId = null;
let namesHidden = true;

document.getElementById('toggle-names-btn').onclick = function() {
    namesHidden = !namesHidden;
    this.innerHTML = namesHidden 
        ? `<ion-icon name="eye-off-outline"></ion-icon> Hide Names`
        : `<ion-icon name="eye-outline"></ion-icon> Show Names`;
    
    // Reverse logic to match actual expectation: 
    // If namesHidden is true, button should say "Show Names" (action to take)
    // If namesHidden is false, button should say "Hide Names" (action to take)
    if (namesHidden) {
        this.innerHTML = `<ion-icon name="eye-outline"></ion-icon> Show Names`;
    } else {
        this.innerHTML = `<ion-icon name="eye-off-outline"></ion-icon> Hide Names`;
    }

    const resultsTbody = document.getElementById('results-tbody');
    const rows = resultsTbody.querySelectorAll('tr');
    rows.forEach(row => {
        const nameCell = row.cells[0];
        const emailCell = row.cells[1];
        if (nameCell && emailCell) {
            if (namesHidden) {
                nameCell.dataset.originalContent = nameCell.innerHTML;
                emailCell.dataset.originalContent = emailCell.innerHTML;
                nameCell.innerHTML = `<span class="text-gray-300 italic">Hidden for Privacy</span>`;
                emailCell.innerHTML = `<span class="text-gray-300 italic">***@***</span>`;
            } else {
                nameCell.innerHTML = nameCell.dataset.originalContent || nameCell.innerHTML;
                emailCell.innerHTML = emailCell.dataset.originalContent || emailCell.innerHTML;
            }
        }
    });

    // Also toggle in item analysis if applicable
    const analysisNames = document.querySelectorAll('.student-name-tag');
    analysisNames.forEach(tag => {
        if (namesHidden) {
            tag.dataset.originalContent = tag.innerHTML;
            tag.innerHTML = "Hidden";
        } else {
            tag.innerHTML = tag.dataset.originalContent || tag.innerHTML;
        }
    });
};

document.getElementById('toggle-table-btn').onclick = function() {
    const container = document.getElementById('results-table-container');
    const chevron = document.getElementById('table-chevron');
    const isHidden = container.classList.toggle('hidden');
    chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
};

document.getElementById('class-filter').onchange = () => {
    if (currentResultsQuizId) viewResults(currentResultsQuizId);
};

window.viewResults = async (quizId) => {
    currentResultsQuizId = quizId;
    showView('teacherResults');
    const resultsTbody = document.getElementById('results-tbody');
    const resultsTitle = document.getElementById('results-quiz-title');
    const classFilter = document.getElementById('class-filter');
    const selectedClass = classFilter.value;

    resultsTbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-gray-400">Loading results...</td></tr>`;

    const qDocRef = doc(db, "quizzes", quizId);
    const qSnap = await getDoc(qDocRef);
    if (qSnap.exists()) {
        resultsTitle.innerText = `Results for ${qSnap.data().title}`;
    }

    // Fetch student mappings for classes
    const studentSnap = await getDocs(collection(db, "students"));
    const studentMap = {};
    const classes = new Set();
    studentSnap.forEach(d => {
        const s = d.data();
        studentMap[s.email.toLowerCase()] = s;
        if (s.class) classes.add(s.class);
    });

    // Update class filter dropdown if it's the first load or "all"
    const currentOptions = Array.from(classFilter.options).map(o => o.value);
    classes.forEach(c => {
        if (!currentOptions.includes(c)) {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            classFilter.appendChild(opt);
        }
    });

    const resQ = query(collection(db, "quiz_attempts"), where("quizId", "==", quizId), orderBy("submittedAt", "desc"));
    const resSnap = await getDocs(resQ);
    
    // Filter results by class if needed
    let filteredDocs = resSnap.docs;
    if (selectedClass !== "all") {
        filteredDocs = resSnap.docs.filter(d => {
            const email = d.data().studentEmail.toLowerCase();
            return studentMap[email] && studentMap[email].class === selectedClass;
        });
    }

    resultsTbody.innerHTML = "";
    if (filteredDocs.length === 0) {
        resultsTbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-gray-400 italic">No results found ${selectedClass !== "all" ? "for class " + selectedClass : ""}.</td></tr>`;
    }

    let totalScore = 0;
    let counts = 0;
    let passing = 0;

    filteredDocs.forEach(d => {
        const att = d.data();
        totalScore += att.score;
        counts++;
        if (att.score >= att.totalQuestions / 2) passing++;

        const studentData = studentMap[att.studentEmail.toLowerCase()] || {};
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-50 transition-colors";
        
        const displayName = namesHidden ? `<span class="text-gray-300 italic">Hidden for Privacy</span>` : `${att.studentName} ${studentData.class ? `<span class="ml-2 bg-gray-100 text-gray-500 text-[9px] px-2 py-0.5 rounded uppercase font-black tracking-widest">${studentData.class}</span>` : ''}`;
        const displayEmail = namesHidden ? `<span class="text-gray-300 italic">***@***</span>` : att.studentEmail;
        
        row.innerHTML = `
            <td class="px-6 py-5 font-bold text-gray-800 text-sm" data-original-content='${att.studentName} ${studentData.class ? `<span class="ml-2 bg-gray-100 text-gray-500 text-[9px] px-2 py-0.5 rounded uppercase font-black tracking-widest">${studentData.class}</span>` : ''}'>
                ${displayName}
            </td>
            <td class="px-6 py-5 text-xs text-gray-400 font-mono" data-original-content='${att.studentEmail}'>
                ${displayEmail}
            </td>
            <td class="px-6 py-5 font-black text-sm ${att.score >= att.totalQuestions / 2 ? 'text-green-600' : 'text-red-500'}">${att.score} / ${att.totalQuestions}</td>
            <td class="px-6 py-5 text-[10px] text-gray-400 uppercase font-bold tracking-widest">
                ${att.submittedAt?.toDate().toLocaleDateString()} 
                <span class="block text-[8px] opacity-70 mt-1 italic font-medium">${att.submittedAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </td>
            <td class="px-6 py-5 text-right">
                <button class="text-gray-300 hover:text-red-500 transition-colors p-2" onclick="deleteAttempt('${d.id}', '${quizId}')">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            </td>
        `;
        resultsTbody.appendChild(row);
    });

    document.getElementById('stat-avg-score').innerText = counts === 0 ? "-" : (totalScore / counts).toFixed(1);
    document.getElementById('stat-takers').innerText = counts;
    document.getElementById('stat-pass').innerText = passing;

    // ----------------------------------------------------
    // QUIZ SETTINGS & RETAKE TOGGLE
    // ----------------------------------------------------
    const retakeBtn = document.getElementById('toggle-retakes-btn');
    const updateRetakeUI = (allowed) => {
        const text = document.getElementById('retake-text');
        const icon = document.getElementById('retake-icon');
        if (allowed) {
            text.innerText = "Unlimited Retakes";
            retakeBtn.classList.add('bg-blue-100', 'text-blue-700');
            retakeBtn.classList.remove('bg-gray-100', 'text-gray-700');
            icon.name = "infinite-outline";
        } else {
            text.innerText = "Standard (One Try)";
            retakeBtn.classList.add('bg-gray-100', 'text-gray-700');
            retakeBtn.classList.remove('bg-blue-100', 'text-blue-700');
            icon.name = "refresh-outline";
        }
    };
    const currentQuizData = qSnap.data();
    updateRetakeUI(currentQuizData.allowRetakes || false);

    retakeBtn.onclick = async () => {
        const isAllowed = !(currentQuizData.allowRetakes || false);
        try {
            await updateDoc(doc(db, "quizzes", quizId), { allowRetakes: isAllowed });
            viewResults(quizId); // refresh
        } catch (e) { alert(e.message); }
    };

    // ----------------------------------------------------
    // QUIZ ANALYSIS LOGIC (UPDATED WITH CLASS FILTER)
    // ----------------------------------------------------
    const analysisContainer = document.getElementById('quiz-analysis-container');
    analysisContainer.innerHTML = "";

    const quiz = qSnap.data();
    quiz.questions.forEach((q, qIdx) => {
        const countsByOption = [0, 0, 0, 0];
        filteredDocs.forEach(d => {
            const studentChoice = d.data().answers[qIdx];
            if (studentChoice !== undefined && studentChoice !== null) {
                countsByOption[studentChoice]++;
            }
        });

        const questionDiv = document.createElement('div');
        questionDiv.className = "bg-white p-10 rounded-3xl border shadow-sm";
        questionDiv.innerHTML = `
                <div class="mb-6 border-b pb-6">
                <span class="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em]">Question ${qIdx + 1}</span>
                <div class="text-lg font-bold mt-2 text-gray-800 leading-tight prose prose-indigo max-w-none">${q.text}</div>
            </div>
            
            <div class="space-y-6">
                ${q.options.map((opt, optIdx) => {
                    const count = countsByOption[optIdx];
                    const totalForQuestion = countsByOption.reduce((a, b) => a + b, 0);
                    const percentage = totalForQuestion === 0 ? 0 : Math.round((count / totalForQuestion) * 100);
                    const isCorrect = optIdx === q.correctAnswer;
                    const hasOptionImage = q.optionImages && q.optionImages[optIdx];
                    const hasText = opt && opt.trim().length > 0;
                    
                    return `
                        <div>
                            <div class="flex justify-between items-start mb-2 px-1">
                                <div class="flex flex-col gap-2">
                                    <span class="text-sm font-bold ${isCorrect ? 'text-green-600' : 'text-gray-500'}">
                                        <span class="mr-2 font-black">${String.fromCharCode(65 + optIdx)}</span> ${hasText ? opt : '<span class="italic text-gray-300">No text</span>'} ${isCorrect ? '✓' : ''}
                                    </span>
                                    ${hasOptionImage ? `<img src="${q.optionImages[optIdx]}" class="max-h-24 w-auto rounded-lg border bg-white shadow-sm mt-1">` : ''}
                                </div>
                                <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest text-right whitespace-nowrap ml-4">${count} students (${percentage}%)</span>
                            </div>
                            <div class="w-full bg-gray-50 rounded-full h-4 overflow-hidden border border-gray-100 p-0.5">
                                <div class="${isCorrect ? 'bg-green-500' : 'bg-indigo-400'} h-full rounded-full transition-all duration-1000 shadow-sm" style="width: ${percentage}%"></div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        analysisContainer.appendChild(questionDiv);

        // Render KaTeX for analysis text
        if (window.renderMathInElement) {
            renderMathInElement(questionDiv, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
    });
};

document.getElementById('back-to-teacher-results').onclick = () => {
    showView('teacher');
    document.getElementById('class-filter').value = "all"; // Reset filter
};

window.deleteAttempt = async (attemptId, quizId) => {
    if (confirm("Are you sure you want to delete this specific student response? This cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "quiz_attempts", attemptId));
            viewResults(quizId); // Refresh the view
        } catch (error) {
            console.error("Error deleting response:", error);
            alert("Error deleting response: " + error.message);
        }
    }
};

// ----------------------------------------------------
// STUDENT DASHBOARD & QUIZ ROOM LOGIC
// ----------------------------------------------------
const studentQuizList = document.getElementById('student-quiz-list');
const studentAttemptsTable = document.getElementById('student-attempts-table');const joinQuizCodeInput = document.getElementById('join-quiz-code-input');
const joinQuizBtn = document.getElementById('join-quiz-btn');
const joinError = document.getElementById('join-error');

joinQuizBtn.onclick = async () => {
    const code = joinQuizCodeInput.value.trim().toUpperCase();
    if (!code) return;

    joinError.classList.add('hidden');
    joinQuizBtn.disabled = true;
    joinQuizBtn.innerText = "JOINING...";

    try {
        const q = query(collection(db, "quizzes"), where("quizCode", "==", code));
        const snap = await getDocs(q);

        if (snap.empty) {
            joinError.innerText = "Invalid Quiz Code. Please check with your teacher.";
            joinError.classList.remove('hidden');
        } else {
            const docSnap = snap.docs[0];
            startQuiz(docSnap.id, docSnap.data());
        }
    } catch (err) {
        console.error("Join Error:", err);
        joinError.innerText = "Error: " + err.message;
        joinError.classList.remove('hidden');
    } finally {
        joinQuizBtn.disabled = false;
        joinQuizBtn.innerText = "JOIN";
    }
};
async function refreshStudentDashboard() {
    studentQuizList.innerHTML = `<div class="p-10 text-gray-400 font-bold">Loading...</div>`;
    const qzSnap = await getDocs(query(collection(db, "quizzes"), orderBy("createdAt", "desc")));
    
    studentQuizList.innerHTML = "";
    qzSnap.forEach(d => {
        const qz = d.data();
        const card = document.createElement('div');
        card.className = "bg-white p-8 rounded-2xl shadow-sm border hover:shadow-md transition-all";
        card.innerHTML = `
            <h3 class="text-xl font-black mb-2">${qz.title}</h3>
            <p class="text-sm text-gray-500 mb-6 italic line-clamp-1">${qz.description || "N/A"}</p>
            <button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg active:scale-95" onclick="startQuiz('${d.id}')">
                Begin Quiz
            </button>
        `;
        studentQuizList.appendChild(card);
    });

    const attSnap = await getDocs(query(collection(db, "quiz_attempts"), where("studentId", "==", currentUser.uid), orderBy("submittedAt", "desc")));
    studentAttemptsTable.innerHTML = "";
    attSnap.forEach(d => {
        const att = d.data();
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-50 cursor-pointer transition-colors";
        row.onclick = () => viewAttemptDetail(d.id);
        row.innerHTML = `
            <td class="px-6 py-4 font-bold text-sm text-gray-700">${att.quizTitle}</td>
            <td class="px-6 py-4 font-black ${att.score >= att.totalQuestions / 2 ? 'text-green-600' : 'text-red-500'}">${att.score} / ${att.totalQuestions}</td>
            <td class="px-6 py-4 text-xs text-gray-400 italic">
                ${att.submittedAt?.toDate().toLocaleDateString()}
                <span class="block text-[10px] opacity-70 mt-1">${att.submittedAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </td>
        `;
        studentAttemptsTable.appendChild(row);
    });
}

// ----------------------------------------------------
// STUDENT ATTEMPT DETAIL LOGIC
// ----------------------------------------------------
window.viewAttemptDetail = async (attemptId) => {
    showView('attemptDetail');
    const container = document.getElementById('attempt-questions-review');
    container.innerHTML = `<div class="p-10 text-center text-gray-400">Loading details...</div>`;

    try {
        const attSnap = await getDoc(doc(db, "quiz_attempts", attemptId));
        if (!attSnap.exists()) return;
        const att = attSnap.data();

        const quizSnap = await getDoc(doc(db, "quizzes", att.quizId));
        if (!quizSnap.exists()) return;
        const quiz = quizSnap.data();

        document.getElementById('attempt-quiz-title').innerText = quiz.title;
        document.getElementById('attempt-date').innerText = `Attempted on ${att.submittedAt?.toDate().toLocaleString()}`;
        document.getElementById('attempt-score-display').innerText = `${att.score} / ${att.totalQuestions}`;

        // Setup retake button
        const retakeBtn = document.getElementById('retake-quiz-btn');
        retakeBtn.onclick = () => startQuiz(att.quizId);

        container.innerHTML = "";
        quiz.questions.forEach((q, qIdx) => {
            const studentAnswer = att.answers[qIdx];
            const isCorrect = studentAnswer === q.correctAnswer;
            
            const div = document.createElement('div');
            div.className = `p-8 rounded-3xl border-2 ${isCorrect ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`;
            div.innerHTML = `
                <div class="flex items-center gap-3 mb-6">
                    <span class="text-xs font-black uppercase tracking-widest ${isCorrect ? 'text-green-600' : 'text-red-500'}">Question ${qIdx + 1}</span>
                    <span class="text-[10px] bg-white px-2 py-1 rounded-full font-bold shadow-sm ${isCorrect ? 'text-green-600' : 'text-red-500'}">
                        ${isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                </div>
                <div class="mb-6">
                    <div class="text-lg font-bold mb-4 prose prose-indigo max-w-none">${q.text}</div>
                </div>
                
                <div class="space-y-3 mb-6">
                    ${q.options.map((opt, i) => {
                        let style = "bg-white text-gray-400 border border-gray-100";
                        let icon = "";
                        
                        // Student's choice
                        if (i === studentAnswer) {
                            if (isCorrect) {
                                style = "bg-green-600 text-white border-green-600 shadow-md";
                                icon = '<ion-icon name="checkmark-circle"></ion-icon>';
                            } else {
                                style = "bg-red-500 text-white border-red-500 shadow-md";
                                icon = '<ion-icon name="close-circle"></ion-icon>';
                            }
                        } else if (i === q.correctAnswer) {
                            // Show correct answer if student got it wrong
                            style = "bg-green-100 text-green-700 border-green-200 border-dashed border-2";
                            icon = '<ion-icon name="checkmark-circle-outline"></ion-icon>';
                        }

                        const hasImage = q.optionImages && q.optionImages[i];
                        const hasText = opt && opt.trim().length > 0;

                        return `
                            <div class="p-4 rounded-xl flex items-center justify-between font-bold ${style}">
                                <div class="flex-1 space-y-2">
                                    ${hasImage ? `<img src="${q.optionImages[i]}" class="max-h-32 object-contain rounded-lg border bg-white shadow-sm">` : ''}
                                    ${hasText ? `<span>${opt}</span>` : (!hasImage ? `<span class="italic text-gray-300">Empty option</span>` : '')}
                                </div>
                                <span class="text-2xl ml-4">${icon}</span>
                            </div>
                        `;
                    }).join('')}
                </div>

                ${q.explanation ? `
                    <div class="p-6 bg-indigo-50 rounded-2xl border border-indigo-100">
                        <h5 class="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <ion-icon name="bulb-outline"></ion-icon> Explanation
                        </h5>
                        <p class="text-indigo-900 font-medium">${q.explanation}</p>
                    </div>
                ` : ''}
            `;
            container.appendChild(div);

            // Re-render KaTeX
            if (window.renderMathInElement) {
                renderMathInElement(div, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }
        });

    } catch (err) {
        console.error("Error loading attempt detail:", err);
        container.innerHTML = `<div class="p-10 text-red-500">Error loading details.</div>`;
    }
};

document.getElementById('back-to-student-dashboard').onclick = () => showView('student');

// Quiz Room State
let activeQuiz = null;
let activeQuizId = null;
let currentQIdx = 0;
let studentAnswers = [];
let feedbackShown = false;
let isPreviewMode = false;

window.startQuiz = async (quizId, quizData = null) => {
    isPreviewMode = false;
    
    // Check if retakes are allowed
    const quizRef = doc(db, "quizzes", quizId);
    const snap = quizData ? { exists: () => true, data: () => quizData } : await getDoc(quizRef);
    if (!snap.exists()) return;
    
    activeQuiz = snap.data();
    activeQuizId = quizId;

    if (userRole === 'student') {
        const attemptId = `${currentUser.email.toLowerCase()}_${quizId}`;
        const attemptSnap = await getDoc(doc(db, "quiz_attempts", attemptId));
        
        if (attemptSnap.exists() && !activeQuiz.allowRetakes) {
            alert("This quiz does not allow retakes. You have already submitted your response.");
            return;
        }
    }
    
    currentQIdx = 0;
    studentAnswers = new Array(activeQuiz.questions.length).fill(null);
    feedbackShown = false;
    
    showView('quizRoom');
    exitPreviewBtn.classList.add('hidden');
    renderQuizQuestion();
};

window.previewQuiz = async (quizId) => {
    const snap = await getDoc(doc(db, "quizzes", quizId));
    if (!snap.exists()) return;
    
    activeQuiz = snap.data();
    activeQuizId = quizId;
    currentQIdx = 0;
    studentAnswers = new Array(activeQuiz.questions.length).fill(null);
    feedbackShown = false;
    isPreviewMode = true;
    
    showView('quizRoom');
    exitPreviewBtn.classList.remove('hidden');
    renderQuizQuestion();
};

exitPreviewBtn.onclick = () => {
    isPreviewMode = false;
    showView('teacher');
};

function renderQuizQuestion() {
    const q = activeQuiz.questions[currentQIdx];
    document.getElementById('quiz-room-subtitle').innerText = `Quiz: ${activeQuiz.title}`;
    document.getElementById('quiz-room-q-number').innerText = `Question ${currentQIdx + 1} of ${activeQuiz.questions.length}`;
    
    const textTarget = document.getElementById('question-text-display');
    const imageTarget = document.getElementById('question-image-display');
    const optionsTarget = document.getElementById('options-container');
    const dotsTarget = document.getElementById('quiz-progress-dots');
    const nextBtn = document.getElementById('next-question-btn');

    // Use innerHTML instead of innerText for textTarget to support rich text content
    textTarget.innerHTML = q.text;
    textTarget.classList.add('prose', 'prose-indigo', 'max-w-none');
    
    // Hide the separate imageTarget as image is now handled within TinyMCE inline
    imageTarget.classList.add('hidden');

    optionsTarget.innerHTML = "";
    q.options.forEach((opt, i) => {
        const hasText = opt && opt.trim().length > 0;
        const hasImage = q.optionImages && q.optionImages[i];
        
        const btn = document.createElement('button');
        btn.id = `opt-${i}`;
        btn.className = `w-full text-left p-4 md:p-6 rounded-2xl border-2 transition-all flex items-start gap-4 ${studentAnswers[currentQIdx] === i ? 'border-blue-600 bg-blue-50 text-blue-800 ring-4 ring-blue-50 shadow-sm font-black' : 'border-gray-100 hover:bg-gray-50 text-gray-600 font-medium'}`;
        
        btn.innerHTML = `
            <div class="w-8 h-8 rounded-full border-2 flex-shrink-0 flex items-center justify-center font-bold text-sm mt-0.5 ${studentAnswers[currentQIdx] === i ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200'}">
                ${String.fromCharCode(65 + i)}
            </div>
            <div class="flex-1 space-y-3">
                ${hasImage ? `<img src="${q.optionImages[i]}" class="w-full max-h-48 object-contain rounded-lg border bg-white">` : ''}
                ${hasText ? `<span class="block">${opt}</span>` : (!hasImage ? `<span class="text-gray-300 italic">Empty option</span>` : '')}
            </div>
        `;
        btn.onclick = () => {
            studentAnswers[currentQIdx] = i;
            renderQuizQuestion();
        };
        optionsTarget.appendChild(btn);
    });

    dotsTarget.innerHTML = activeQuiz.questions.map((_, i) => `<div class="w-2 h-2 rounded-full ${i === currentQIdx ? 'bg-blue-600' : studentAnswers[i] !== null ? 'bg-green-400' : 'bg-gray-200'}"></div>`).join('');

    if (currentQIdx === activeQuiz.questions.length - 1) {
        nextBtn.innerHTML = `<span>Finish Quiz</span> <ion-icon name="send-outline"></ion-icon>`;
    } else {
        nextBtn.innerHTML = `<span>Next</span> <ion-icon name="chevron-forward"></ion-icon>`;
    }

    // Trigger KaTeX rendering
    if (window.renderMathInElement) {
        renderMathInElement(textTarget, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError: false
        });
    }
}

document.getElementById('prev-question-btn').onclick = () => {
    if (currentQIdx > 0) {
        currentQIdx--;
        renderQuizQuestion();
    }
};

document.getElementById('next-question-btn').onclick = async () => {
    if (currentQIdx < activeQuiz.questions.length - 1) {
        currentQIdx++;
        renderQuizQuestion();
    } else {
        // Submit Quiz
        if (studentAnswers.includes(null)) return alert("Please answer all questions before finishing.");
        
        const nextBtn = document.getElementById('next-question-btn');
        nextBtn.disabled = true;
        nextBtn.innerText = "Submitting...";

        let score = 0;
        activeQuiz.questions.forEach((q, i) => {
            if (q.correctAnswer === studentAnswers[i]) score++;
        });

        try {
            if (isPreviewMode) {
                alert(`Preview complete! Your score would have been ${score} / ${activeQuiz.questions.length}. No results were recorded.`);
                showView('teacher');
                refreshTeacherDashboard();
                return;
            }

            // Get student name from prepopulated student list if available
            let studentName = currentUser.displayName;
            const studentDoc = await getDoc(doc(db, "students", currentUser.email.toLowerCase()));
            if (studentDoc.exists()) {
                studentName = studentDoc.data().name;
            }

            // Prevent duplicate attempts by using a unique document ID (email + quizId)
            // This ensures only one attempt per student per quiz is recorded
            const attemptId = `${currentUser.email.toLowerCase()}_${activeQuizId}`;
            await setDoc(doc(db, "quiz_attempts", attemptId), {
                quizId: activeQuizId,
                quizTitle: activeQuiz.title,
                studentId: currentUser.uid,
                studentName: studentName,
                studentEmail: currentUser.email,
                answers: studentAnswers,
                score: score,
                totalQuestions: activeQuiz.questions.length,
                submittedAt: serverTimestamp()
            });

            showView('student');
            refreshStudentDashboard();
        } catch (err) {
            alert(err.message);
        } finally {
            nextBtn.disabled = false;
        }
    }
};

// Removed checkAnswer function as per user request (feedback after submission only)
