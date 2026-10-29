/**
 * AdSwap - Universal Monetag & Ad SDK Exchange
 * Dynamic runtime script parser and injector for browser context
 */

// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBwpa8mA83JAv2A2Dj0rh5VHwodyv5N3dg",
    authDomain: "freegcash-ads.firebaseapp.com",
    databaseURL: "https://freegcash-ads-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "freegcash-ads",
    storageBucket: "freegcash-ads.firebasestorage.app",
    messagingSenderId: "608086825364",
    appId: "1:608086825364:web:3a8e628d231b52c6171781"
};

// Economic Parameters
const APP_RULES = {
  INITIAL_BALANCE: 1,           // Default user starting balance = 1 Credit
  POST_COST: 1,                 // Consumes 1 Credit to post in public feed
  COMPLETION_REWARD: 1,         // Grants +1 Credit upon completion
  MAX_PUBLIC_VIEWS: 10,         // Maximum 10 unique user completions per post
  REQUIRED_INTERSTITIALS: 5,    // 5 rewarded interstitial clicks
  REQUIRED_POPUPS: 1            // 1 rewarded popup click
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

// --- 2. GLOBAL STATE ---
let currentUser = null;
let userProfile = {
  name: "User",
  credits: APP_RULES.INITIAL_BALANCE,
  completedCount: 0
};
let allTasks = {};
let activeTab = "available";

// Active runner state
let activeTask = null;
let currentRunnerState = {
  interstitialsDone: 0,
  popupsDone: 0
};

const injectedScripts = new Set();

// --- 3. DOM ELEMENT REFERENCES ---
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

// --- 4. TOAST NOTIFICATION UTILITY ---
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");

  const styles = {
    success: "bg-emerald-600 text-white",
    error: "bg-rose-600 text-white",
    info: "bg-slate-900 border border-slate-700 text-slate-100",
    warning: "bg-amber-600 text-white"
  };

  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
    warning: "fa-triangle-exclamation"
  };

  toast.className = `pointer-events-auto px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs sm:text-sm font-medium transition-all transform duration-300 translate-y-2 opacity-0 ${styles[type] || styles.info}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> <span>${message}</span>`;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- 5. UNIVERSAL SCRIPT PARSER & RUNTIME INJECTOR ---
/**
 * Accepts ANY input format:
 * - Full HTML <script> tags: <script src='//libtl.com/sdk.js' data-zone='10555663' data-sdk='show_10555663'></script>
 * - Function name: show_10555663
 * - Pure zone ID: 10555663
 * - Inline Javascript snippet
 */
function parseUniversalInput(input) {
  input = input.trim();

  // Pattern A: Monetag <script> with data-zone and data-sdk
  const zoneMatch = input.match(/data-zone=['"]([^'"]+)['"]/i);
  const sdkMatch = input.match(/data-sdk=['"]([^'"]+)['"]/i);
  const srcMatch = input.match(/src=['"]([^'"]+)['"]/i);

  if (zoneMatch || srcMatch) {
    const zone = zoneMatch ? zoneMatch[1] : "zone_" + Math.floor(Math.random() * 100000);
    const sdkFunction = sdkMatch ? sdkMatch[1] : `show_${zone}`;
    const scriptSrc = srcMatch ? srcMatch[1] : `//libtl.com/sdk.js`;

    return {
      rawInput: input,
      zone,
      sdkFunction,
      scriptSrc,
      type: "script_tag"
    };
  }

  // Pattern B: Function name provided like show_10555663
  const funcMatch = input.match(/show_([0-9]+)/i);
  if (funcMatch) {
    const zone = funcMatch[1];
    return {
      rawInput: input,
      zone,
      sdkFunction: `show_${zone}`,
      scriptSrc: `//libtl.com/sdk.js`,
      type: "function_name"
    };
  }

  // Pattern C: Pure numeric zone ID e.g. 10555663
  const numberMatch = input.match(/\b([0-9]{5,10})\b/);
  if (numberMatch) {
    const zone = numberMatch[1];
    return {
      rawInput: input,
      zone,
      sdkFunction: `show_${zone}`,
      scriptSrc: `//libtl.com/sdk.js`,
      type: "zone_id"
    };
  }

  // Pattern D: Generic Inline JS snippet / fallback
  return {
    rawInput: input,
    zone: "custom_" + Date.now().toString().slice(-6),
    sdkFunction: "show_custom",
    scriptSrc: "//libtl.com/sdk.js",
    type: "custom_js"
  };
}

/**
 * Dynamically injects script element into document head at runtime
 */
function injectScriptToHead(task) {
  return new Promise((resolve) => {
    const { zone, sdkFunction, scriptSrc, rawInput } = task;

    // Check if function already exists globally
    if (typeof window[sdkFunction] === "function") {
      return resolve(window[sdkFunction]);
    }

    const scriptId = `dynamic-sdk-${zone}`;
    if (document.getElementById(scriptId)) {
      return waitForGlobalFunction(sdkFunction, resolve);
    }

    // Create script element dynamically
    const script = document.createElement("script");
    script.id = scriptId;

    // Parse attributes from raw input if full HTML tag was passed
    if (rawInput && rawInput.includes("<script")) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = rawInput;
      const parsedScript = tempDiv.querySelector("script");
      if (parsedScript) {
        Array.from(parsedScript.attributes).forEach((attr) => {
          script.setAttribute(attr.name, attr.value);
        });
      }
    }

    // Ensure required Monetag attributes exist
    if (!script.src && scriptSrc) {
      script.src = scriptSrc.startsWith("//") ? `https:${scriptSrc}` : scriptSrc;
    }
    if (!script.getAttribute("data-zone") && zone) {
      script.setAttribute("data-zone", zone);
    }
    if (!script.getAttribute("data-sdk") && sdkFunction) {
      script.setAttribute("data-sdk", sdkFunction);
    }
    script.async = true;

    script.onload = () => {
      injectedScripts.add(zone);
      waitForGlobalFunction(sdkFunction, resolve);
    };

    script.onerror = () => {
      console.warn("External SDK script failed or was blocked by AdBlocker.");
      resolve(null);
    };

    document.head.appendChild(script);
  });
}

function waitForGlobalFunction(sdkFunction, resolve) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (typeof window[sdkFunction] === "function") {
      clearInterval(interval);
      resolve(window[sdkFunction]);
    } else if (attempts > 25) {
      clearInterval(interval);
      resolve(window[sdkFunction] || null);
    }
  }, 100);
}

// --- 6. AUTHENTICATION & USER INITIALIZATION ---
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    profileUid.textContent = user.uid;
    await syncUserProfile(user.uid);
    listenToTasks();
  } else {
    try {
      await auth.signInAnonymously();
    } catch (e) {
      showToast("Auth initialization error: " + e.message, "error");
    }
  }
});

async function syncUserProfile(uid) {
  const userRef = db.ref(`users/${uid}`);

  userRef.on("value", (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      // Default initial balance = 1 Credit
      const initial = {
        name: `User_${uid.substring(0, 5)}`,
        credits: APP_RULES.INITIAL_BALANCE,
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
  profileCredits.textContent = `${userProfile.credits || 0} Credits`;
  profileCompletedCount.textContent = userProfile.completedCount || 0;
  profileDisplayName.value = userProfile.name || "";
}

// Save Profile Display Name
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

// Faucet button for test credits
btnClaimFreeCoins.addEventListener("click", async () => {
  if (!currentUser) return;
  try {
    await db.ref(`users/${currentUser.uid}/credits`).transaction((c) => (c || 0) + 3);
    showToast("+3 Test Credits added!", "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
});

// --- 7. PUBLIC TASK FEED REALTIME LISTENER ---
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

  // Order newest first
  taskList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const availableTasks = taskList.filter((t) => {
    const completions = t.completions ? Object.keys(t.completions).length : 0;
    return completions < APP_RULES.MAX_PUBLIC_VIEWS;
  });

  const completedTasks = taskList.filter((t) => {
    const completions = t.completions ? Object.keys(t.completions).length : 0;
    return completions >= APP_RULES.MAX_PUBLIC_VIEWS;
  });

  countAvailable.textContent = availableTasks.length;
  const currentList = activeTab === "available" ? availableTasks : completedTasks;

  if (currentList.length === 0) {
    tasksGrid.innerHTML = `
      <div class="col-span-full py-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
        <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-xl">
          <i class="fa-solid fa-rectangle-ad"></i>
        </div>
        <h3 class="text-sm font-bold text-slate-300">No public ad posts found</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1">
          ${activeTab === "available" ? "Use your 1 Credit to post a Monetag tag in the public area!" : "No completed tasks yet."}
        </p>
      </div>
    `;
    return;
  }

  currentList.forEach((task) => {
    tasksGrid.appendChild(createTaskCard(task));
  });
}

function createTaskCard(task) {
  const completions = task.completions ? Object.keys(task.completions).length : 0;
  const isCompletedByMe = currentUser && task.completions && task.completions[currentUser.uid];
  const isMyTask = currentUser && task.authorId === currentUser.uid;
  const isFull = completions >= APP_RULES.MAX_PUBLIC_VIEWS;

  const card = document.createElement("div");
  card.className = "bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between transition group";

  let statusBadge = `<span class="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">Public Post</span>`;
  if (isFull) {
    statusBadge = `<span class="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400">Claimed (10/10)</span>`;
  } else if (isCompletedByMe) {
    statusBadge = `<span class="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"><i class="fa-solid fa-check"></i> Completed</span>`;
  } else if (isMyTask) {
    statusBadge = `<span class="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">Your Post</span>`;
  }

  card.innerHTML = `
    <div>
      <div class="flex items-center justify-between gap-2 mb-2">
        ${statusBadge}
        <span class="text-[11px] font-mono text-slate-400">Zone: ${escapeHtml(task.zone)}</span>
      </div>

      <h3 class="text-sm font-bold text-white mb-1 line-clamp-1 group-hover:text-indigo-400 transition">
        ${escapeHtml(task.title)}
      </h3>
      
      <p class="text-xs text-slate-400 mb-4 flex items-center gap-1">
        <i class="fa-solid fa-user text-slate-500 text-[10px]"></i>
        <span>By ${escapeHtml(task.authorName || "Anonymous")}</span>
      </p>

      <!-- Post Stats -->
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 space-y-1.5">
        <div class="flex items-center justify-between text-xs text-slate-300">
          <span class="flex items-center gap-1 text-slate-400"><i class="fa-solid fa-film text-indigo-400"></i> Interstitial:</span>
          <span class="font-bold text-white">5 Ads</span>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-300">
          <span class="flex items-center gap-1 text-slate-400"><i class="fa-solid fa-window-restore text-indigo-400"></i> Popup Ad:</span>
          <span class="font-bold text-white">1 Popup</span>
        </div>
        <div class="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <span class="text-slate-400">Completer Earns:</span>
          <span class="font-bold text-amber-300 flex items-center gap-1">
            <i class="fa-solid fa-coins text-amber-400"></i> +1 Credit
          </span>
        </div>
      </div>

      <!-- Completion Bar -->
      <div class="space-y-1 mb-4">
        <div class="flex justify-between text-[11px] text-slate-400 font-medium">
          <span>Public Viewers</span>
          <span class="font-bold text-slate-300">${completions} / ${APP_RULES.MAX_PUBLIC_VIEWS}</span>
        </div>
        <div class="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
          <div class="bg-indigo-500 h-full rounded-full transition-all duration-300" style="width: ${(completions / APP_RULES.MAX_PUBLIC_VIEWS) * 100}%"></div>
        </div>
      </div>
    </div>

    <div>
      ${getCardButtonHTML(isFull, isCompletedByMe, isMyTask)}
    </div>
  `;

  const btnStart = card.querySelector(".btn-start-task");
  if (btnStart) {
    btnStart.addEventListener("click", () => openTaskRunner(task));
  }

  return card;
}

function getCardButtonHTML(isFull, isCompletedByMe, isMyTask) {
  if (isFull) {
    return `<button disabled class="w-full py-2 bg-slate-800 text-slate-500 rounded-xl font-semibold text-xs cursor-not-allowed">
      Fully Viewable Limit Reached (10/10)
    </button>`;
  }
  if (isCompletedByMe) {
    return `<button disabled class="w-full py-2 bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 rounded-xl font-semibold text-xs cursor-not-allowed">
      <i class="fa-solid fa-check"></i> Credit Claimed
    </button>`;
  }
  if (isMyTask) {
    return `<button disabled class="w-full py-2 bg-slate-800/60 text-slate-400 border border-slate-700 rounded-xl font-semibold text-xs cursor-not-allowed">
      Your Public Post
    </button>`;
  }
  return `<button class="btn-start-task w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-xs shadow-md shadow-indigo-600/20 transition flex items-center justify-center gap-1.5">
    <i class="fa-solid fa-play"></i> Watch Ads (+1 Credit)
  </button>`;
}

// --- 8. POSTING TASK LOGIC ---
btnOpenCreateModal.addEventListener("click", () => {
  if ((userProfile.credits || 0) < APP_RULES.POST_COST) {
    showToast(`Posting requires ${APP_RULES.POST_COST} Credit. Complete public posts to earn!`, "warning");
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

  if ((userProfile.credits || 0) < APP_RULES.POST_COST) {
    showToast("You need at least 1 Credit to post.", "error");
    return;
  }

  const parsed = parseUniversalInput(rawSnippet);

  const btnSubmit = document.getElementById("btnSubmitTask");
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Posting...`;

  try {
    // 1. Deduct 1 Credit atomically
    const userCreditsRef = db.ref(`users/${currentUser.uid}/credits`);
    const tx = await userCreditsRef.transaction((current) => {
      if ((current || 0) < APP_RULES.POST_COST) return;
      return current - APP_RULES.POST_COST;
    });

    if (!tx.committed) {
      throw new Error("Insufficient credit balance to post.");
    }

    // 2. Publish to public realtime feed
    const newTaskRef = db.ref("tasks").push();
    await newTaskRef.set({
      title,
      zone: parsed.zone,
      sdkFunction: parsed.sdkFunction,
      scriptSrc: parsed.scriptSrc,
      rawInput: rawSnippet,
      authorId: currentUser.uid,
      authorName: userProfile.name || "Anonymous",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      completions: {}
    });

    showToast("Ad post published to public feed! -1 Credit", "success");
    formCreateTask.reset();
    modalCreateTask.classList.add("hidden");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `Publish Post (-1 Credit)`;
  }
});

// --- 9. TASK RUNNER & AD PLAYBACK ENGINE ---
async function openTaskRunner(task) {
  activeTask = task;
  currentRunnerState = { interstitialsDone: 0, popupsDone: 0 };

  runnerTaskTitle.textContent = task.title;
  modalTaskRunner.classList.remove("hidden");
  updateRunnerUI();

  showToast("Injecting Monetag SDK into DOM...", "info");
  await injectScriptToHead(task);
}

btnCloseRunnerModal.addEventListener("click", () => {
  if (currentRunnerState.interstitialsDone > 0 || currentRunnerState.popupsDone > 0) {
    if (!confirm("Exit session? Unfinished ad progress will be lost.")) return;
  }
  modalTaskRunner.classList.add("hidden");
  activeTask = null;
});

function updateRunnerUI() {
  const totalSteps = APP_RULES.REQUIRED_INTERSTITIALS + APP_RULES.REQUIRED_POPUPS;
  const currentTotal = currentRunnerState.interstitialsDone + currentRunnerState.popupsDone;

  runnerOverallText.textContent = `${currentTotal} / ${totalSteps}`;
  runnerProgressBar.style.width = `${(currentTotal / totalSteps) * 100}%`;

  // Interstitials (Step 1)
  interstitialBadge.textContent = `${currentRunnerState.interstitialsDone} / ${APP_RULES.REQUIRED_INTERSTITIALS}`;
  interstitialCount.textContent = currentRunnerState.interstitialsDone;

  if (currentRunnerState.interstitialsDone >= APP_RULES.REQUIRED_INTERSTITIALS) {
    btnTriggerInterstitial.disabled = true;
    btnTriggerInterstitial.className = "w-full py-2.5 px-4 bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 rounded-xl font-semibold text-xs flex items-center justify-center gap-2";
    btnInterstitialText.textContent = `Rewarded Interstitials Finished (5/5)`;

    btnTriggerPopup.disabled = false;
    btnTriggerPopup.className = "w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-semibold text-xs shadow-lg flex items-center justify-center gap-2 transition";
    btnPopupText.textContent = `Watch Rewarded Popup (${currentRunnerState.popupsDone}/1)`;
  } else {
    btnTriggerInterstitial.disabled = false;
    btnTriggerInterstitial.className = "w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-xs shadow-lg flex items-center justify-center gap-2 transition";
    btnInterstitialText.textContent = `Watch Rewarded Interstitial (${currentRunnerState.interstitialsDone}/5)`;

    btnTriggerPopup.disabled = true;
    btnTriggerPopup.className = "w-full py-2.5 px-4 bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-xl font-semibold text-xs border border-slate-700 flex items-center justify-center gap-2";
    btnPopupText.textContent = "Watch Rewarded Popup (Complete Step 1 First)";
  }

  // Popup (Step 2)
  popupBadge.textContent = `${currentRunnerState.popupsDone} / ${APP_RULES.REQUIRED_POPUPS}`;
  if (currentRunnerState.popupsDone >= APP_RULES.REQUIRED_POPUPS) {
    btnTriggerPopup.disabled = true;
    btnTriggerPopup.className = "w-full py-2.5 px-4 bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 rounded-xl font-semibold text-xs flex items-center justify-center gap-2";
    btnPopupText.textContent = `Rewarded Popup Finished (1/1)`;
  }

  // Claim Reward
  if (currentRunnerState.interstitialsDone >= APP_RULES.REQUIRED_INTERSTITIALS && currentRunnerState.popupsDone >= APP_RULES.REQUIRED_POPUPS) {
    btnClaimReward.disabled = false;
    btnClaimReward.className = "w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl text-sm sm:text-base shadow-xl transition flex items-center justify-center gap-2 glow-active cursor-pointer";
  } else {
    btnClaimReward.disabled = true;
    btnClaimReward.className = "w-full py-3.5 bg-slate-800 disabled:opacity-40 text-white font-bold rounded-2xl text-sm sm:text-base transition flex items-center justify-center gap-2";
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
      // Execute user Monetag SDK rewarded interstitial: show_XXXXX()
      await window[sdkName]();
      showToast("Ad viewed successfully!", "success");
      currentRunnerState.interstitialsDone++;
    } else {
      // Fallback for adblockers / sandbox mode
      await new Promise((r) => setTimeout(r, 2500));
      showToast("Ad impression recorded", "info");
      currentRunnerState.interstitialsDone++;
    }
  } catch (err) {
    showToast("Ad playback finished or closed", "warning");
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
  btnPopupText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Triggering Popup...`;

  try {
    if (typeof window[sdkName] === "function") {
      // Execute user Monetag SDK popup: show_XXXXX('pop')
      await window[sdkName]("pop");
      showToast("Popup ad viewed!", "success");
      currentRunnerState.popupsDone++;
    } else {
      await new Promise((r) => setTimeout(r, 2000));
      showToast("Popup impression recorded", "info");
      currentRunnerState.popupsDone++;
    }
  } catch (err) {
    showToast("Popup closed", "warning");
    currentRunnerState.popupsDone++;
  } finally {
    updateRunnerUI();
  }
});

// 9C. Claim Reward (+1 Credit in Firebase)
btnClaimReward.addEventListener("click", async () => {
  if (!currentUser || !activeTask) return;

  btnClaimReward.disabled = true;
  btnClaimReward.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Claiming +1 Credit...`;

  const taskId = activeTask.id;
  const uid = currentUser.uid;

  try {
    // 1. Transaction to claim spot in completions (limit 10 users)
    const taskCompletionsRef = db.ref(`tasks/${taskId}/completions`);
    const tx = await taskCompletionsRef.transaction((completions) => {
      completions = completions || {};
      if (Object.keys(completions).length >= APP_RULES.MAX_PUBLIC_VIEWS) return;
      if (completions[uid]) return;
      completions[uid] = firebase.database.ServerValue.TIMESTAMP;
      return completions;
    });

    if (!tx.committed) {
      throw new Error("Task already completed or full (10/10).");
    }

    // 2. Add +1 Credit to user balance
    await db.ref(`users/${uid}/credits`).transaction((c) => (c || 0) + APP_RULES.COMPLETION_REWARD);

    // 3. Update completed counter
    await db.ref(`users/${uid}/completedCount`).transaction((c) => (c || 0) + 1);

    showToast("🎉 +1 Credit added to your account balance!", "success");
    modalTaskRunner.classList.add("hidden");
    activeTask = null;
  } catch (err) {
    showToast(err.message, "error");
    btnClaimReward.disabled = false;
    btnClaimReward.innerHTML = `<i class="fa-solid fa-gift"></i> Claim +1 Credit`;
  }
});

// --- 10. TABS & UI CONTROLS ---
tabAvailable.addEventListener("click", () => {
  activeTab = "available";
  tabAvailable.className = "px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md transition";
  tabCompleted.className = "px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 rounded-xl text-xs sm:text-sm font-semibold transition";
  renderTasks();
});

tabCompleted.addEventListener("click", () => {
  activeTab = "completed";
  tabCompleted.className = "px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md transition";
  tabAvailable.className = "px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 rounded-xl text-xs sm:text-sm font-semibold transition";
  renderTasks();
});

btnProfileModal.addEventListener("click", () => modalProfile.classList.remove("hidden"));
btnCloseProfileModal.addEventListener("click", () => modalProfile.classList.add("hidden"));

btnRefresh.addEventListener("click", () => {
  btnRefresh.classList.add("animate-spin");
  setTimeout(() => {
    renderTasks();
    btnRefresh.classList.remove("animate-spin");
    showToast("Public feed updated", "info");
  }, 350);
});

// HTML escaping helper
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}