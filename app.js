/**
 * Monetag Task & Credit Exchange Platform
 * Integrates Firebase Realtime Database + Monetag Dynamic SDK Injection
 */

// --- 1. CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBwpa8mA83JAv2A2Dj0rh5VHwodyv5N3dg",
  authDomain: "freegcash-ads.firebaseapp.com",
  databaseURL: "https://freegcash-ads-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "freegcash-ads",
  storageBucket: "freegcash-ads.firebasestorage.app",
  messagingSenderId: "608086825364",
  appId: "1:608086825364:web:3a8e628d231b52c6171781"
};

// Economic Rules
const TASK_RULES = {
  POST_COST: 1,                 // 1 credit consumed to post
  COMPLETION_REWARD: 1,         // 1 credit granted to each completing user
  MAX_COMPLETIONS: 10,          // Exactly 10 users allowed to complete
  REQUIRED_INTERSTITIALS: 5,    // 5 rewarded interstitial clicks
  REQUIRED_POPUPS: 1            // 1 rewarded popup click
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

// --- 2. STATE ---
let currentUser = null;
let userProfile = {
  name: "User",
  credits: 5,
  completedCount: 0
};
let allTasks = {};
let activeTab = "available"; // 'available' | 'completed'

// Active runner state
let activeTask = null;
let currentRunnerState = {
  interstitialsDone: 0,
  popupsDone: 0
};

// Cached injected SDK scripts to avoid re-injecting duplicate script tags
const loadedScripts = new Set();

// --- 3. DOM ELEMENTS ---
const headerCredits = document.getElementById("headerCredits");
const headerUsername = document.getElementById("headerUsername");
const tasksGrid = document.getElementById("tasksGrid");
const countAvailable = document.getElementById("countAvailable");
const tabAvailable = document.getElementById("tabAvailable");
const tabCompleted = document.getElementById("tabCompleted");

// Modals
const modalCreateTask = document.getElementById("modalCreateTask");
const btnOpenCreateModal = document.getElementById("btnOpenCreateModal");
const btnCloseCreateModal = document.getElementById("btnCloseCreateModal");
const formCreateTask = document.getElementById("formCreateTask");
const modalBalance = document.getElementById("modalBalance");

const modalTaskRunner = document.getElementById("modalTaskRunner");
const btnCloseRunnerModal = document.getElementById("btnCloseRunnerModal");
const runnerTaskTitle = document.getElementById("runnerTaskTitle");
const runnerOverallText = document.getElementById("runnerOverallText");
const runnerProgressBar = document.getElementById("runnerProgressBar");
const interstitialBadge = document.getElementById("interstitialBadge");
const interstitialCount = document.getElementById("interstitialCount");
const btnTriggerInterstitial = document.getElementById("btnTriggerInterstitial");
const btnInterstitialText = document.getElementById("btnInterstitialText");
const popupBadge = document.getElementById("popupBadge");
const btnTriggerPopup = document.getElementById("btnTriggerPopup");
const btnPopupText = document.getElementById("btnPopupText");
const btnClaimReward = document.getElementById("btnClaimReward");

const modalProfile = document.getElementById("modalProfile");
const btnProfileModal = document.getElementById("btnProfileModal");
const btnCloseProfileModal = document.getElementById("btnCloseProfileModal");
const profileUid = document.getElementById("profileUid");
const profileCredits = document.getElementById("profileCredits");
const profileCompletedCount = document.getElementById("profileCompletedCount");
const profileDisplayName = document.getElementById("profileDisplayName");
const formChangeName = document.getElementById("formChangeName");
const btnClaimFreeCoins = document.getElementById("btnClaimFreeCoins");
const btnRefresh = document.getElementById("btnRefresh");

// --- 4. TOAST NOTIFICATIONS ---
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");

  const colors = {
    success: "bg-emerald-600 text-white",
    error: "bg-rose-600 text-white",
    info: "bg-slate-800 text-slate-100 border border-slate-700",
    warning: "bg-amber-600 text-white"
  };

  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
    warning: "fa-triangle-exclamation"
  };

  toast.className = `pointer-events-auto px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs sm:text-sm font-medium transition-all transform duration-300 translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> <span>${message}</span>`;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- 5. MONETAG PARSER & SCRIPT INJECTOR ---
/**
 * Extracts zone, sdk function name, and script url from user input
 * Accepts full tags like:
 * <script src='//libtl.com/sdk.js' data-zone='10555663' data-sdk='show_10555663'></script>
 * or simply zone IDs like 10555663
 */
function parseMonetagInput(input) {
  input = input.trim();

  // Pattern 1: Zone and SDK inside script tag
  const zoneMatch = input.match(/data-zone=['"]([^'"]+)['"]/i);
  const sdkMatch = input.match(/data-sdk=['"]([^'"]+)['"]/i);
  const srcMatch = input.match(/src=['"]([^'"]+)['"]/i);

  if (zoneMatch) {
    const zone = zoneMatch[1];
    const sdkFunction = sdkMatch ? sdkMatch[1] : `show_${zone}`;
    const scriptSrc = srcMatch ? srcMatch[1] : `//libtl.com/sdk.js`;
    return { zone, sdkFunction, scriptSrc };
  }

  // Pattern 2: User just provided pure function name like show_10555663
  const funcMatch = input.match(/show_([0-9]+)/i);
  if (funcMatch) {
    const zone = funcMatch[1];
    return {
      zone,
      sdkFunction: `show_${zone}`,
      scriptSrc: `//libtl.com/sdk.js`
    };
  }

  // Pattern 3: Pure number zone ID
  const numberMatch = input.match(/\b([0-9]{5,10})\b/);
  if (numberMatch) {
    const zone = numberMatch[1];
    return {
      zone,
      sdkFunction: `show_${zone}`,
      scriptSrc: `//libtl.com/sdk.js`
    };
  }

  return null;
}

/**
 * Dynamically injects the Monetag SDK into document.head
 */
function injectMonetagSdk(task) {
  return new Promise((resolve, reject) => {
    const { zone, sdkFunction, scriptSrc } = task;

    // Check if function already exists on window
    if (typeof window[sdkFunction] === "function") {
      return resolve(window[sdkFunction]);
    }

    const scriptId = `monetag-sdk-${zone}`;
    if (document.getElementById(scriptId)) {
      // Script already injected, wait for function
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof window[sdkFunction] === "function") {
          clearInterval(interval);
          resolve(window[sdkFunction]);
        } else if (attempts > 30) {
          clearInterval(interval);
          resolve(window[sdkFunction]); // Fallback resolve anyway
        }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = scriptSrc.startsWith("//") ? `https:${scriptSrc}` : scriptSrc;
    script.setAttribute("data-zone", zone);
    script.setAttribute("data-sdk", sdkFunction);
    script.async = true;

    script.onload = () => {
      loadedScripts.add(zone);
      // Wait momentarily for the global function definition
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof window[sdkFunction] === "function") {
          clearInterval(interval);
          resolve(window[sdkFunction]);
        } else if (attempts > 20) {
          clearInterval(interval);
          resolve(window[sdkFunction]);
        }
      }, 100);
    };

    script.onerror = (err) => {
      console.warn("Monetag script could not be loaded (likely blocked by AdBlocker):", err);
      // Still resolve to allow simulated/sandbox flow if testing
      resolve(null);
    };

    document.head.appendChild(script);
  });
}

// --- 6. AUTHENTICATION & PROFILE SETUP ---
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    profileUid.textContent = user.uid;
    await syncUserProfile(user.uid);
    listenToTasks();
  } else {
    // Sign in anonymously
    try {
      await auth.signInAnonymously();
    } catch (e) {
      console.error("Anonymous auth error:", e);
      showToast("Authentication error: " + e.message, "error");
    }
  }
});

async function syncUserProfile(uid) {
  const userRef = db.ref(`users/${uid}`);

  // Fetch initial profile or initialize default
  userRef.on("value", (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      // First-time user: Give 5 welcome credits
      const initial = {
        name: `User_${uid.substring(0, 5)}`,
        credits: 5,
        completedCount: 0,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      userRef.set(initial);
      userProfile = initial;
    } else {
      userProfile = data;
    }
    updateUIProfile();
  });
}

function updateUIProfile() {
  headerCredits.textContent = userProfile.credits || 0;
  headerUsername.textContent = userProfile.name || "User";
  modalBalance.textContent = userProfile.credits || 0;
  profileCredits.textContent = `${userProfile.credits || 0} Coins`;
  profileCompletedCount.textContent = userProfile.completedCount || 0;
  profileDisplayName.value = userProfile.name || "";
}

// Update User Name
formChangeName.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const newName = profileDisplayName.value.trim();
  if (!newName) return;

  try {
    await db.ref(`users/${currentUser.uid}/name`).set(newName);
    showToast("Profile name updated!", "success");
    modalProfile.classList.add("hidden");
  } catch (err) {
    showToast("Error updating name: " + err.message, "error");
  }
});

// Faucet Free Coins for testing
btnClaimFreeCoins.addEventListener("click", async () => {
  if (!currentUser) return;
  try {
    const userRef = db.ref(`users/${currentUser.uid}/credits`);
    await userRef.transaction((current) => (current || 0) + 5);
    showToast("+5 Welcome Credits added!", "success");
  } catch (err) {
    showToast("Error claiming credits: " + err.message, "error");
  }
});

// --- 7. TASKS REALTIME LISTENER ---
function listenToTasks() {
  const tasksRef = db.ref("tasks");
  tasksRef.on("value", (snapshot) => {
    allTasks = snapshot.val() || {};
    renderTasks();
  });
}

function renderTasks() {
  tasksGrid.innerHTML = "";
  const taskList = Object.entries(allTasks).map(([id, data]) => ({ id, ...data }));

  // Sort newest first
  taskList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const availableTasks = taskList.filter((t) => {
    const completions = t.completions ? Object.keys(t.completions).length : 0;
    return completions < TASK_RULES.MAX_COMPLETIONS;
  });

  const completedTasks = taskList.filter((t) => {
    const completions = t.completions ? Object.keys(t.completions).length : 0;
    return completions >= TASK_RULES.MAX_COMPLETIONS;
  });

  countAvailable.textContent = availableTasks.length;

  const currentList = activeTab === "available" ? availableTasks : completedTasks;

  if (currentList.length === 0) {
    tasksGrid.innerHTML = `
      <div class="col-span-full py-16 text-center bg-slate-800/20 border border-slate-800 rounded-2xl">
        <div class="w-16 h-16 mx-auto mb-3 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-2xl">
          <i class="fa-solid fa-inbox"></i>
        </div>
        <h3 class="text-base font-semibold text-slate-300">No tasks found</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1">
          ${activeTab === "available" ? "Be the first to post a Monetag task for other users to view!" : "No completed tasks yet."}
        </p>
      </div>
    `;
    return;
  }

  currentList.forEach((task) => {
    const card = createTaskCard(task);
    tasksGrid.appendChild(card);
  });
}

function createTaskCard(task) {
  const completions = task.completions ? Object.keys(task.completions).length : 0;
  const isCompletedByMe = currentUser && task.completions && task.completions[currentUser.uid];
  const isMyTask = currentUser && task.authorId === currentUser.uid;
  const isFull = completions >= TASK_RULES.MAX_COMPLETIONS;

  const card = document.createElement("div");
  card.className = "bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition group";

  // Card Badges
  let statusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">Active</span>`;
  if (isFull) {
    statusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-300">Completed (10/10)</span>`;
  } else if (isCompletedByMe) {
    statusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"><i class="fa-solid fa-check"></i> You Earned</span>`;
  } else if (isMyTask) {
    statusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">Your Post</span>`;
  }

  card.innerHTML = `
    <div>
      <div class="flex items-center justify-between gap-2 mb-2">
        ${statusBadge}
        <span class="text-xs font-mono text-slate-400">Zone: ${task.zone}</span>
      </div>

      <h3 class="text-base font-bold text-white mb-1 line-clamp-1 group-hover:text-indigo-400 transition">
        ${escapeHtml(task.title)}
      </h3>
      
      <p class="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
        <i class="fa-solid fa-circle-user text-slate-500"></i>
        <span>By ${escapeHtml(task.authorName || "Anonymous")}</span>
      </p>

      <!-- Task Details Box -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 mb-4 space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-300">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-film text-indigo-400"></i> Rewarded Ads:</span>
          <span class="font-bold text-white">5 &times; Interstitial</span>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-300">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-window-restore text-indigo-400"></i> Popup Ad:</span>
          <span class="font-bold text-white">1 &times; Rewarded Popup</span>
        </div>
        <div class="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <span class="text-slate-400">Reward:</span>
          <span class="font-bold text-amber-300 flex items-center gap-1">
            <i class="fa-solid fa-coins text-amber-400"></i> +1 Credit
          </span>
        </div>
      </div>

      <!-- Completion Progress -->
      <div class="space-y-1.5 mb-5">
        <div class="flex justify-between text-xs text-slate-400 font-medium">
          <span>Users Completed</span>
          <span class="font-bold text-slate-200">${completions} / ${TASK_RULES.MAX_COMPLETIONS}</span>
        </div>
        <div class="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
          <div class="bg-indigo-500 h-full rounded-full transition-all duration-300" style="width: ${(completions / TASK_RULES.MAX_COMPLETIONS) * 100}%"></div>
        </div>
      </div>
    </div>

    <!-- Action Button -->
    <div>
      ${getActionButtonHTML(task, isFull, isCompletedByMe, isMyTask)}
    </div>
  `;

  // Attach start listener
  const btnStart = card.querySelector(".btn-start-task");
  if (btnStart) {
    btnStart.addEventListener("click", () => openTaskRunner(task));
  }

  return card;
}

function getActionButtonHTML(task, isFull, isCompletedByMe, isMyTask) {
  if (isFull) {
    return `<button disabled class="w-full py-2.5 bg-slate-800 text-slate-500 rounded-xl font-semibold text-xs cursor-not-allowed">
      Task Fully Claimed (10/10)
    </button>`;
  }
  if (isCompletedByMe) {
    return `<button disabled class="w-full py-2.5 bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 rounded-xl font-semibold text-xs cursor-not-allowed">
      <i class="fa-solid fa-circle-check"></i> Already Completed
    </button>`;
  }
  if (isMyTask) {
    return `<button disabled class="w-full py-2.5 bg-slate-800/60 text-slate-400 border border-slate-700 rounded-xl font-semibold text-xs cursor-not-allowed">
      <i class="fa-solid fa-eye"></i> Viewing Your Own Post
    </button>`;
  }
  return `<button class="btn-start-task w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-xs shadow-lg shadow-indigo-600/20 transition flex items-center justify-center gap-1.5">
    <i class="fa-solid fa-play"></i> Start Task (+1 Credit)
  </button>`;
}

// --- 8. TASK CREATION LOGIC ---
btnOpenCreateModal.addEventListener("click", () => {
  if ((userProfile.credits || 0) < TASK_RULES.POST_COST) {
    showToast(`You need at least ${TASK_RULES.POST_COST} Credit to post a task. Complete tasks or claim free credits!`, "warning");
    return;
  }
  modalCreateTask.classList.remove("hidden");
});

btnCloseCreateModal.addEventListener("click", () => {
  modalCreateTask.classList.add("hidden");
});

formCreateTask.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const title = document.getElementById("taskTitle").value.trim();
  const rawSnippet = document.getElementById("taskSdkSnippet").value.trim();

  // Validate user balance
  if ((userProfile.credits || 0) < TASK_RULES.POST_COST) {
    showToast(`Insufficient balance! You need ${TASK_RULES.POST_COST} credit to post.`, "error");
    return;
  }

  // Parse Monetag Tag
  const parsed = parseMonetagInput(rawSnippet);
  if (!parsed || !parsed.zone) {
    showToast("Invalid Monetag Code! Please paste the full SDK script tag or a valid Zone ID (e.g. 10555663).", "error");
    return;
  }

  const btnSubmit = document.getElementById("btnSubmitTask");
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Publishing...`;

  try {
    // 1. Deduct 1 Credit atomically using Firebase transaction
    const userCreditsRef = db.ref(`users/${currentUser.uid}/credits`);
    const txResult = await userCreditsRef.transaction((currentBalance) => {
      if ((currentBalance || 0) < TASK_RULES.POST_COST) {
        return; // Abort transaction if insufficient credits
      }
      return currentBalance - TASK_RULES.POST_COST;
    });

    if (!txResult.committed) {
      throw new Error("Could not deduct credit. Insufficient balance.");
    }

    // 2. Create the task post
    const newTaskRef = db.ref("tasks").push();
    const newTaskData = {
      title,
      zone: parsed.zone,
      sdkFunction: parsed.sdkFunction,
      scriptSrc: parsed.scriptSrc,
      authorId: currentUser.uid,
      authorName: userProfile.name || "Anonymous",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      completions: {}
    };

    await newTaskRef.set(newTaskData);

    showToast("Task posted successfully! 1 Credit deducted.", "success");
    formCreateTask.reset();
    modalCreateTask.classList.add("hidden");
  } catch (err) {
    console.error("Task post error:", err);
    showToast(err.message, "error");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `Publish Post (-1 Credit)`;
  }
});

// --- 9. MONETAG TASK RUNNER ENGINE ---
async function openTaskRunner(task) {
  activeTask = task;
  currentRunnerState = {
    interstitialsDone: 0,
    popupsDone: 0
  };

  runnerTaskTitle.textContent = task.title;
  modalTaskRunner.classList.remove("hidden");
  updateRunnerUI();

  // Inject SDK script
  showToast("Injecting Monetag Ad SDK...", "info");
  await injectMonetagSdk(task);
}

btnCloseRunnerModal.addEventListener("click", () => {
  if (currentRunnerState.interstitialsDone > 0 || currentRunnerState.popupsDone > 0) {
    if (!confirm("Are you sure you want to exit? Your ad progress for this session will be lost.")) {
      return;
    }
  }
  modalTaskRunner.classList.add("hidden");
  activeTask = null;
});

function updateRunnerUI() {
  const totalSteps = TASK_RULES.REQUIRED_INTERSTITIALS + TASK_RULES.REQUIRED_POPUPS;
  const currentTotal = currentRunnerState.interstitialsDone + currentRunnerState.popupsDone;

  runnerOverallText.textContent = `${currentTotal} / ${totalSteps}`;
  const pct = (currentTotal / totalSteps) * 100;
  runnerProgressBar.style.width = `${pct}%`;

  // Interstitial status
  interstitialBadge.textContent = `${currentRunnerState.interstitialsDone} / ${TASK_RULES.REQUIRED_INTERSTITIALS}`;
  interstitialCount.textContent = currentRunnerState.interstitialsDone;

  if (currentRunnerState.interstitialsDone >= TASK_RULES.REQUIRED_INTERSTITIALS) {
    btnTriggerInterstitial.disabled = true;
    btnTriggerInterstitial.className = "w-full py-3 px-4 bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 rounded-xl font-semibold text-sm flex items-center justify-center gap-2";
    btnInterstitialText.textContent = `Rewarded Interstitials Complete (5/5)`;
    
    // Unlock popup button
    btnTriggerPopup.disabled = false;
    btnTriggerPopup.className = "w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-semibold text-sm shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition";
    btnPopupText.textContent = `Watch Rewarded Popup (${currentRunnerState.popupsDone}/1)`;
  } else {
    btnTriggerInterstitial.disabled = false;
    btnTriggerInterstitial.className = "w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white rounded-xl font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition";
    btnInterstitialText.textContent = `Watch Rewarded Ad (${currentRunnerState.interstitialsDone}/5)`;

    btnTriggerPopup.disabled = true;
    btnTriggerPopup.className = "w-full py-3 px-4 bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded-xl font-semibold text-sm border border-slate-700 flex items-center justify-center gap-2 transition";
    btnPopupText.textContent = "Watch Rewarded Popup (Finish Step 1 first)";
  }

  // Popup status
  popupBadge.textContent = `${currentRunnerState.popupsDone} / ${TASK_RULES.REQUIRED_POPUPS}`;
  if (currentRunnerState.popupsDone >= TASK_RULES.REQUIRED_POPUPS) {
    btnTriggerPopup.disabled = true;
    btnTriggerPopup.className = "w-full py-3 px-4 bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 rounded-xl font-semibold text-sm flex items-center justify-center gap-2";
    btnPopupText.textContent = `Rewarded Popup Complete (1/1)`;
  }

  // Claim button status
  if (currentRunnerState.interstitialsDone >= TASK_RULES.REQUIRED_INTERSTITIALS && currentRunnerState.popupsDone >= TASK_RULES.REQUIRED_POPUPS) {
    btnClaimReward.disabled = false;
    btnClaimReward.className = "w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl text-base shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-2 ad-pulse cursor-pointer";
  } else {
    btnClaimReward.disabled = true;
    btnClaimReward.className = "w-full py-3.5 bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl text-base shadow-lg transition flex items-center justify-center gap-2";
  }
}

// 9A. Rewarded Interstitial Trigger
btnTriggerInterstitial.addEventListener("click", async () => {
  if (!activeTask) return;
  const sdkName = activeTask.sdkFunction;

  btnTriggerInterstitial.disabled = true;
  btnInterstitialText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Playing Ad...`;

  try {
    if (typeof window[sdkName] === "function") {
      // Execute the user's Monetag function for rewarded interstitial:
      // show_XXXXX().then(...)
      await window[sdkName]();
      showToast("Ad viewed successfully!", "success");
      currentRunnerState.interstitialsDone++;
    } else {
      // Fallback for adblocker or sandbox testing
      console.warn(`Function window.${sdkName} is not available. Using fallback timer.`);
      await simulateAdPlayback(3000);
      showToast("Ad viewed (fallback test mode)", "info");
      currentRunnerState.interstitialsDone++;
    }
  } catch (err) {
    console.warn("Monetag Ad playback error:", err);
    showToast("Ad display ended or closed.", "warning");
    // Increment progress if rewarded
    currentRunnerState.interstitialsDone++;
  } finally {
    updateRunnerUI();
  }
});

// 9B. Rewarded Popup Trigger
btnTriggerPopup.addEventListener("click", async () => {
  if (!activeTask) return;
  const sdkName = activeTask.sdkFunction;

  btnTriggerPopup.disabled = true;
  btnPopupText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Opening Popup...`;

  try {
    if (typeof window[sdkName] === "function") {
      // Execute Monetag rewarded popup:
      // show_XXXXX('pop').then(...)
      await window[sdkName]("pop");
      showToast("Rewarded popup viewed!", "success");
      currentRunnerState.popupsDone++;
    } else {
      await simulateAdPlayback(2500);
      showToast("Rewarded popup viewed (fallback test mode)", "info");
      currentRunnerState.popupsDone++;
    }
  } catch (err) {
    console.warn("Monetag Popup playback error:", err);
    showToast("Popup closed.", "warning");
    currentRunnerState.popupsDone++;
  } finally {
    updateRunnerUI();
  }
});

// Helper for dev test / adblockers
function simulateAdPlayback(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 9C. Claim Reward (+1 Credit in Firebase)
btnClaimReward.addEventListener("click", async () => {
  if (!currentUser || !activeTask) return;

  if (currentRunnerState.interstitialsDone < TASK_RULES.REQUIRED_INTERSTITIALS || currentRunnerState.popupsDone < TASK_RULES.REQUIRED_POPUPS) {
    showToast("Please finish all 5 interstitials and 1 popup first!", "warning");
    return;
  }

  btnClaimReward.disabled = true;
  btnClaimReward.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Claiming 1 Credit...`;

  const taskId = activeTask.id;
  const uid = currentUser.uid;

  try {
    // 1. Transaction to register completion on task if < 10 users
    const taskCompletionsRef = db.ref(`tasks/${taskId}/completions`);
    const taskTx = await taskCompletionsRef.transaction((completions) => {
      completions = completions || {};
      if (Object.keys(completions).length >= TASK_RULES.MAX_COMPLETIONS) {
        return; // Task already filled by 10 users
      }
      if (completions[uid]) {
        return; // User already completed this
      }
      completions[uid] = firebase.database.ServerValue.TIMESTAMP;
      return completions;
    });

    if (!taskTx.committed) {
      throw new Error("Task was already completed by 10 users or by your account.");
    }

    // 2. Award +1 Credit to the completing user
    const userCreditsRef = db.ref(`users/${uid}/credits`);
    await userCreditsRef.transaction((current) => (current || 0) + TASK_RULES.COMPLETION_REWARD);

    // 3. Increment user's completedCount stat
    const userCompletedCountRef = db.ref(`users/${uid}/completedCount`);
    await userCompletedCountRef.transaction((current) => (current || 0) + 1);

    showToast("🎉 Congratulations! +1 Credit added to your account!", "success");
    modalTaskRunner.classList.add("hidden");
    activeTask = null;
  } catch (err) {
    console.error("Claim error:", err);
    showToast(err.message, "error");
    btnClaimReward.disabled = false;
    btnClaimReward.innerHTML = `<i class="fa-solid fa-gift"></i> Claim +1 Credit`;
  }
});

// --- 10. TABS & MODAL CONTROLS ---
tabAvailable.addEventListener("click", () => {
  activeTab = "available";
  tabAvailable.className = "px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs sm:text-sm font-semibold transition";
  tabCompleted.className = "px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs sm:text-sm font-semibold transition";
  renderTasks();
});

tabCompleted.addEventListener("click", () => {
  activeTab = "completed";
  tabCompleted.className = "px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs sm:text-sm font-semibold transition";
  tabAvailable.className = "px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs sm:text-sm font-semibold transition";
  renderTasks();
});

btnProfileModal.addEventListener("click", () => {
  modalProfile.classList.remove("hidden");
});

btnCloseProfileModal.addEventListener("click", () => {
  modalProfile.classList.add("hidden");
});

btnRefresh.addEventListener("click", () => {
  btnRefresh.classList.add("animate-spin");
  setTimeout(() => {
    renderTasks();
    btnRefresh.classList.remove("animate-spin");
    showToast("Tasks refreshed", "info");
  }, 400);
});

// Utility to escape HTML and prevent XSS in task titles
function escapeHtml(string) {
  const entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return String(string).replace(/[&<>"']/g, (s) => entityMap[s]);
}