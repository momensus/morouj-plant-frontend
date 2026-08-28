// Morouj Commodities LTD - Tomato Paste Plant Application Core Logic (v2.1 Context-Aware Toggles)
//
// API base URL is provided by config.js (MOROUJ_API_BASE). When empty, requests
// go to the same origin (monolith / Cloudflare redirect setup).
function apiUrl(path) {
    if (!window.MOROUJ_API_BASE) return path;
    return window.MOROUJ_API_BASE.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

let state = {
    token: localStorage.getItem("morouj_token") || null,
    user: JSON.parse(localStorage.getItem("morouj_user") || "null"),
    currentDate: new Date().toISOString().split("T")[0],
    barrelPriceSDG: 1500000.0,
    charts: {},
    activeDowntime: null,
    downtimeTimerInterval: null
};

const OPERATOR_PERM_KEYS = [
    "concentration_cooker",
    "cooker_setpoint",
    "concentration_filler",
    "concentration_final",
    "temperature_cooker",
    "temperature_filler",
    "temperature_final",
    "downtime_tracking",
    "raw_barrels",
    "can_filler",
    "packet_filler",
    "palletizer"
];

const MANAGEMENT_PERM_KEYS = [
    "kpi_avg_brix",
    "kpi_avg_temperature",
    "kpi_total_downtime",
    "kpi_product_produced",
    "kpi_raw_used",
    "kpi_raw_wasted",
    "kpi_capital_wasted",
    "chart_concentration",
    "chart_temperature",
    "chart_downtime",
    "chart_raw_used",
    "chart_product_produced",
    "chart_raw_wasted",
    "chart_capital_wasted",
    "table_downtime_log",
    "export_buttons"
];

// ==========================================
// 1. INITIALIZATION & ROUTING
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
    initHourSelect();
    startClock();
    
    // Set date picker defaults
    const datePicker = document.getElementById("mgmt-date-picker");
    if (datePicker) datePicker.value = state.currentDate;

    if (state.token && state.user) {
        setupUserInterface();
    } else {
        showView("login");
    }
    initPushNotifications();
});


function startClock() {
    const clockEl = document.getElementById("header-clock");
    const slotEl = document.getElementById("header-current-slot");

    function update() {
        const now = new Date();
        if (clockEl) clockEl.innerText = now.toTimeString().split(" ")[0];

        const curHour = now.getHours();
        const nextHour = (curHour + 1) % 24;
        const slotText = `${String(curHour).padStart(2, '0')}:00 - ${String(nextHour).padStart(2, '0')}:00`;
        if (slotEl) slotEl.innerText = slotText;
    }
    update();
    setInterval(update, 1000);
}

function initHourSelect() {
    const select = document.getElementById("op-hour-select");
    if (!select) return;
    select.innerHTML = "";

    const currentHour = new Date().getHours();
    for (let h = 0; h < 24; h++) {
        const start = `${String(h).padStart(2, '0')}:00`;
        const end = `${String((h + 1) % 24).padStart(2, '0')}:00`;
        const opt = document.createElement("option");
        opt.value = h;
        opt.innerText = `${start} - ${end}`;
        if (h === currentHour) opt.selected = true;
        select.appendChild(opt);
    }
    checkTimelinessWarning();
}

function checkTimelinessWarning() {
    const select = document.getElementById("op-hour-select");
    const shiftBadge = document.getElementById("op-shift-badge");
    const box = document.getElementById("op-timeliness-status-box");
    const icon = document.getElementById("op-timeliness-icon");
    const text = document.getElementById("op-timeliness-text");
    const sub = document.getElementById("op-timeliness-sub");

    if (!select) return;
    const selectedH = parseInt(select.value);
    const now = new Date();
    const curH = now.getHours();
    const curMin = now.getMinutes();

    // Determine shift
    if (selectedH >= 7 && selectedH < 15) {
        shiftBadge.innerText = "Morning Shift";
        shiftBadge.className = "text-xs font-bold px-2.5 py-1 rounded-lg bg-morouj-gold/20 text-morouj-gold border border-morouj-gold/40";
    } else if (selectedH >= 15 && selectedH < 23) {
        shiftBadge.innerText = "Evening Shift";
        shiftBadge.className = "text-xs font-bold px-2.5 py-1 rounded-lg bg-morouj-green/20 text-morouj-lime border border-morouj-lime/40";
    } else {
        shiftBadge.innerText = "Night Shift";
        shiftBadge.className = "text-xs font-bold px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30";
    }

    // Timeliness rule check (+15 min grace period)
    if (selectedH === curH) {
        if (curMin <= 15) {
            box.className = "bg-morouj-forest-dark/90 border border-morouj-green/50 rounded-2xl p-3 flex items-center space-x-3";
            icon.className = "w-8 h-8 rounded-lg bg-morouj-green/20 text-morouj-lime flex items-center justify-center font-bold";
            icon.innerHTML = "✓";
            text.className = "text-xs font-bold text-morouj-lime";
            text.innerText = `On-Time Window Active (${15 - curMin}m remaining in grace period)`;
            sub.innerText = "Submissions now will be recorded as ON TIME";
        } else {
            box.className = "bg-morouj-forest-dark/90 border border-morouj-orange/50 rounded-2xl p-3 flex items-center space-x-3";
            icon.className = "w-8 h-8 rounded-lg bg-morouj-orange/20 text-morouj-orange flex items-center justify-center font-bold";
            icon.innerHTML = "⚠️";
            text.className = "text-xs font-bold text-morouj-orange";
            text.innerText = `Grace Period Expired (+${curMin - 15}m late)`;
            sub.innerText = "Late submissions will be flagged on Moderator Dashboard";
        }
    } else if (selectedH < curH) {
        box.className = "bg-morouj-forest-dark/90 border border-rose-500/40 rounded-2xl p-3 flex items-center space-x-3";
        icon.className = "w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold";
        icon.innerHTML = "!";
        text.className = "text-xs font-bold text-rose-400";
        text.innerText = "Past Shift Slot (Retroactive Entry)";
        sub.innerText = "Will be flagged with historical timestamp";
    } else {
        box.className = "bg-morouj-forest-dark/80 border border-morouj-forest-light rounded-2xl p-3 flex items-center space-x-3";
        icon.className = "w-8 h-8 rounded-lg bg-morouj-forest-light text-slate-300 flex items-center justify-center font-bold";
        icon.innerHTML = "⏳";
        text.className = "text-xs font-bold text-slate-300";
        text.innerText = "Upcoming Hour Slot";
        sub.innerText = "Log at the end of the operating hour";
    }
}


// ==========================================
// 2. AUTHENTICATION
// ==========================================

async function handleManualLogin(e) {
    e.preventDefault();
    const u = document.getElementById("login-username").value.trim();
    const p = document.getElementById("login-password").value.trim();
    await doLogin(u, p);
}

async function doLogin(username, password) {
    try {
        const res = await fetch(apiUrl("/api/auth/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        
        if (!res.ok) {
            const pinRes = await fetch(apiUrl("/api/auth/pin-login"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, pin_code: password })
            });
            if (!pinRes.ok) {
                const err = await res.json();
                showToast(err.detail || "Authentication failed", true);
                return;
            }
            const data = await pinRes.json();
            setAuthSession(data);
            return;
        }

        const data = await res.json();
        setAuthSession(data);
    } catch (err) {
        showToast("Network error connecting to plant server", true);
    }
}

function setAuthSession(data) {
    state.token = data.access_token;
    state.user = {
        id: data.user_id,
        username: data.username,
        full_name: data.full_name,
        role: data.role,
        shift_mode: data.shift_mode || "morning",
        permissions: data.permissions || {},
        must_change_password: data.must_change_password === true
    };
    localStorage.setItem("morouj_token", state.token);
    localStorage.setItem("morouj_user", JSON.stringify(state.user));
    showToast(`Signed in as ${data.full_name}`);
    setupUserInterface();
    initPushNotifications();
    if (state.user.must_change_password) {
        setTimeout(() => openChangePasswordModal(), 300);
    }
}

function handleLogout() {
    state.token = null;
    state.user = null;
    if (state.downtimeTimerInterval) clearInterval(state.downtimeTimerInterval);
    localStorage.removeItem("morouj_token");
    localStorage.removeItem("morouj_user");
    showView("login");
    showToast("Logged out successfully");
}

function setupUserInterface() {
    if (!state.user) return;

    document.getElementById("user-profile-badge").classList.remove("hidden");
    document.getElementById("user-display-name").innerText = state.user.full_name;
    document.getElementById("user-role-label").innerText = state.user.role.toUpperCase();

    const role = state.user.role;

    if (role === "management") {
        showView("management");
        loadManagementDashboard();
        loadManagerSetpoints();
    } else if (role === "moderator") {
        showView("moderator");
        loadModeratorUsers();
        loadModeratorCompliance();
        loadModeratorAudits();
        loadPlantSettings();
        loadManagerSetpoints();
    } else {
        showView("operator");
        setupAdaptiveOperatorStation();
        loadOperatorShiftMode();
    }

    initPushNotifications();
    lucide.createIcons();
}


function showView(viewName) {
    const views = ["login", "operator", "management", "moderator"];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.toggle("hidden", v !== viewName);
    });

    if (viewName === "login") {
        document.getElementById("user-profile-badge").classList.add("hidden");
    }
    lucide.createIcons();
}


// ==========================================
// 3. ADAPTIVE OPERATOR WORKSTATION
// ==========================================

function setupAdaptiveOperatorStation() {
    document.getElementById("op-user-name").innerText = `${state.user.full_name}'s Workstation`;
    const perms = state.user.permissions || {};
    const container = document.getElementById("dynamic-readings-container");
    container.innerHTML = "";

    // Show/hide Downtime card
    const dtCard = document.getElementById("card-downtime");
    if (dtCard) {
        dtCard.classList.toggle("hidden", !perms.downtime_tracking);
    }
    if (perms.downtime_tracking) {
        checkActiveDowntime();
    }

    let cardsAdded = 0;

    // 1. Cooker Concentration Brix
    if (perms.concentration_cooker) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🔥 Cooker Brix</label>
                    <span class="text-[11px] font-semibold text-slate-400">Sampling Valve</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustFloat('op-cooker-brix', -0.5)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-0.5</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-cooker-brix" step="0.1" placeholder="28.0" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-orange outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°Bx</span>
                    </div>
                    <button type="button" onclick="adjustFloat('op-cooker-brix', 0.5)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-morouj-orange-light text-morouj-orange-dark hover:bg-morouj-orange/20 active:scale-95 shadow-sm">+0.5</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-cooker-brix').value = 27.5" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg hover:bg-slate-100">27.5°</button>
                    <button type="button" onclick="document.getElementById('op-cooker-brix').value = 28.0" class="px-2.5 py-1 bg-morouj-orange-light text-morouj-orange-dark text-[11px] font-bold rounded-lg border border-morouj-orange/30">28.0°</button>
                    <button type="button" onclick="document.getElementById('op-cooker-brix').value = 28.5" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg hover:bg-slate-100">28.5°</button>
                </div>
            </div>
        `;
    }

    // 2. Cooker Setpoint Brix
    if (perms.cooker_setpoint) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🎯 Cooker Setpoint Brix</label>
                    <span class="text-[11px] text-morouj-gold font-bold">Target Setpoint</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-cooker-setpoint" step="0.1" placeholder="28.0" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-gold outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°Bx</span>
                    </div>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-cooker-setpoint').value = 27.5" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg hover:bg-slate-100">27.5°</button>
                    <button type="button" onclick="document.getElementById('op-cooker-setpoint').value = 28.0" class="px-2.5 py-1 bg-morouj-gold-light text-amber-900 text-[11px] font-bold rounded-lg border border-morouj-gold/30">28.0°</button>
                    <button type="button" onclick="document.getElementById('op-cooker-setpoint').value = 28.5" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg hover:bg-slate-100">28.5°</button>
                </div>
            </div>
        `;
    }

    // 3. Filler Brix
    if (perms.concentration_filler) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🥫 Filler Machine Brix</label>
                    <span class="text-[11px] font-semibold text-slate-400">Filler Valve</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustFloat('op-filler-brix', -0.2)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-0.2</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-filler-brix" step="0.1" placeholder="27.0" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-green outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°Bx</span>
                    </div>
                    <button type="button" onclick="adjustFloat('op-filler-brix', 0.2)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-morouj-green-light text-morouj-forest hover:bg-morouj-green/20 active:scale-95 shadow-sm">+0.2</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-filler-brix').value = 26.5" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">26.5°</button>
                    <button type="button" onclick="document.getElementById('op-filler-brix').value = 27.0" class="px-2.5 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-bold rounded-lg">27.0°</button>
                    <button type="button" onclick="document.getElementById('op-filler-brix').value = 27.5" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">27.5°</button>
                </div>
            </div>
        `;
    }

    // 4. Final Product Brix
    if (perms.concentration_final) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🔬 Final Product Brix</label>
                    <span class="text-[11px] text-emerald-600 font-extrabold">Target: 25.5°</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustFloat('op-final-brix', -0.2)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-0.2</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-final-brix" step="0.1" placeholder="25.5" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-gold outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°Bx</span>
                    </div>
                    <button type="button" onclick="adjustFloat('op-final-brix', 0.2)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-morouj-gold-light text-amber-900 hover:bg-morouj-gold/20 active:scale-95 shadow-sm">+0.2</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-final-brix').value = 25.5" class="px-3 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-extrabold rounded-lg border border-morouj-green/40 hover:bg-morouj-green/20">🎯 Exact 25.5°</button>
                    <button type="button" onclick="document.getElementById('op-final-brix').value = 26.0" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">26.0°</button>
                </div>
            </div>
        `;
    }

    // 5. Cooker Temperature
    if (perms.temperature_cooker) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🌡️ Cooker Temperature</label>
                    <span class="text-[11px] font-semibold text-slate-400">Thermal Probe</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustFloat('op-cooker-temp', -1.0)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-1°</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-cooker-temp" step="0.5" placeholder="88.0" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-orange outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°C</span>
                    </div>
                    <button type="button" onclick="adjustFloat('op-cooker-temp', 1.0)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-morouj-orange-light text-morouj-orange-dark hover:bg-morouj-orange/20 active:scale-95 shadow-sm">+1°</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-cooker-temp').value = 85.0" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">85°C</button>
                    <button type="button" onclick="document.getElementById('op-cooker-temp').value = 88.5" class="px-2.5 py-1 bg-morouj-orange-light text-morouj-orange-dark text-[11px] font-bold rounded-lg">88.5°C</button>
                    <button type="button" onclick="document.getElementById('op-cooker-temp').value = 90.0" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">90°C</button>
                </div>
            </div>
        `;
    }

    // 6. Filler Temperature
    if (perms.temperature_filler) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🌡️ Filler Temperature</label>
                    <span class="text-[11px] font-semibold text-slate-400">Filling Temp</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustFloat('op-filler-temp', -1.0)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-1°</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-filler-temp" step="0.5" placeholder="82.0" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-green outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°C</span>
                    </div>
                    <button type="button" onclick="adjustFloat('op-filler-temp', 1.0)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-morouj-green-light text-morouj-forest hover:bg-morouj-green/20 active:scale-95 shadow-sm">+1°</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-filler-temp').value = 80.0" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">80°C</button>
                    <button type="button" onclick="document.getElementById('op-filler-temp').value = 82.0" class="px-2.5 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-bold rounded-lg">82°C</button>
                </div>
            </div>
        `;
    }

    // 7. Final Product Temperature
    if (perms.temperature_final) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🌡️ Final Product Temp</label>
                    <span class="text-[11px] font-semibold text-slate-400">Cooling Outlet</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustFloat('op-final-temp', -1.0)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-1°</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-final-temp" step="0.5" placeholder="42.0" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-forest outline-none shadow-inner text-slate-900">
                        <span class="absolute right-2.5 top-2.5 text-[11px] font-bold text-slate-400 pointer-events-none">°C</span>
                    </div>
                    <button type="button" onclick="adjustFloat('op-final-temp', 1.0)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-slate-200 text-slate-800 hover:bg-slate-300 active:scale-95 shadow-sm">+1°</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="document.getElementById('op-final-temp').value = 40.0" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">40°C</button>
                    <button type="button" onclick="document.getElementById('op-final-temp').value = 42.0" class="px-2.5 py-1 bg-slate-200 text-slate-800 text-[11px] font-bold rounded-lg">42°C</button>
                </div>
            </div>
        `;
    }

    // 8. Raw Barrels Count
    if (perms.raw_barrels) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">📦 Raw Barrels (37° Bx)</label>
                    <span class="text-[11px] font-semibold text-slate-400">242 kg/barrel</span>
                </div>
                <div class="flex items-center space-x-2 w-full min-w-0">
                    <button type="button" onclick="adjustInt('op-raw-barrels', -1)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 shadow-sm text-slate-700">-1</button>
                    <div class="relative flex-1 min-w-0">
                        <input type="number" id="op-raw-barrels" step="1" placeholder="10" class="w-full min-w-0 text-center font-black text-2xl sm:text-3xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-orange outline-none shadow-inner text-slate-900">
                    </div>
                    <button type="button" onclick="adjustInt('op-raw-barrels', 1)" class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-sm bg-morouj-orange-light text-morouj-orange-dark hover:bg-morouj-orange/20 active:scale-95 shadow-sm">+1</button>
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="adjustInt('op-raw-barrels', 2)" class="px-2.5 py-1 bg-white border border-slate-200 text-[11px] font-bold rounded-lg">+2</button>
                    <button type="button" onclick="adjustInt('op-raw-barrels', 5)" class="px-2.5 py-1 bg-morouj-orange-light text-morouj-orange-dark text-[11px] font-bold rounded-lg">+5</button>
                </div>
            </div>
        `;
    }

    // 9. Can Filler Count
    if (perms.can_filler) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">🥫 Cans Produced</label>
                    <span class="text-[11px] font-semibold text-slate-400">Filler Counter</span>
                </div>
                <div class="relative w-full min-w-0">
                    <input type="number" id="op-can-count" step="50" placeholder="e.g. 2400" class="w-full min-w-0 text-center font-black text-2xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-green outline-none shadow-inner text-slate-900">
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="adjustInt('op-can-count', 500)" class="px-3 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-bold rounded-lg">+500</button>
                    <button type="button" onclick="adjustInt('op-can-count', 1000)" class="px-3 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-bold rounded-lg">+1,000</button>
                </div>
            </div>
        `;
    }

    // 10. Universal Packets Count
    if (perms.packet_filler) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-black text-slate-800 uppercase tracking-wider">📄 Sum of Packets</label>
                    <span class="text-[11px] font-semibold text-slate-400">Universal Lines</span>
                </div>
                <div class="relative w-full min-w-0">
                    <input type="number" id="op-packet-count" step="100" placeholder="e.g. 11000" class="w-full min-w-0 text-center font-black text-2xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-green outline-none shadow-inner text-slate-900">
                </div>
                <div class="flex flex-wrap justify-center gap-1.5 pt-1 w-full min-w-0">
                    <button type="button" onclick="adjustInt('op-packet-count', 500)" class="px-3 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-bold rounded-lg">+500</button>
                    <button type="button" onclick="adjustInt('op-packet-count', 1000)" class="px-3 py-1 bg-morouj-green-light text-morouj-forest text-[11px] font-bold rounded-lg">+1,000</button>
                </div>
            </div>
        `;
    }

    // 11. Pallets
    if (perms.palletizer) {
        cardsAdded++;
        container.innerHTML += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 w-full min-w-0 shadow-sm sm:col-span-2">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-black text-slate-800 mb-1">🏗️ Can Pallets (792 kg)</label>
                        <input type="number" id="op-can-pallets" step="0.5" placeholder="1.5" class="w-full min-w-0 text-center font-black text-xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-green outline-none shadow-inner text-slate-900">
                    </div>
                    <div>
                        <label class="block text-xs font-black text-slate-800 mb-1">🏗️ Packet Pallets (550 kg)</label>
                        <input type="number" id="op-packet-pallets" step="0.5" placeholder="1.0" class="w-full min-w-0 text-center font-black text-xl py-2 bg-white border-2 border-slate-300 rounded-xl focus:border-morouj-green outline-none shadow-inner text-slate-900">
                    </div>
                </div>
            </div>
        `;
    }

    if (cardsAdded === 0 && !perms.downtime_tracking) {
        container.innerHTML = `
            <div class="p-6 bg-slate-50 rounded-2xl text-center text-slate-500 sm:col-span-2 text-xs">
                No specific measurements have been toggled on for your account yet.<br>
                Please contact the plant moderator if you need specific readings assigned.
            </div>
        `;
    }

    initHourSelect();
    loadRecentSubmissionsForOperator();
    lucide.createIcons();
}

function adjustInt(inputId, delta) {
    const el = document.getElementById(inputId);
    if (!el) return;
    let v = parseInt(el.value || 0) + delta;
    if (v < 0) v = 0;
    el.value = v;
}

function adjustFloat(inputId, delta) {
    const el = document.getElementById(inputId);
    if (!el) return;
    let v = parseFloat(el.value || 0) + delta;
    if (v < 0) v = 0;
    el.value = v.toFixed(1);
}

// ==========================================
// 4. DOWNTIME TRACKING LOGIC
// ==========================================

async function checkActiveDowntime() {
    try {
        const res = await fetch(apiUrl("/api/downtime/active"), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.is_active) {
            startDowntimeTimer(data.elapsed_seconds, data.id, data.reason);
        } else {
            stopDowntimeTimerDisplay();
        }
    } catch (e) {}
}

function startDowntimeTimer(elapsedSecs, id, reason) {
    state.activeDowntime = { id, elapsedSecs, reason };
    const statusText = document.getElementById("downtime-status-text");
    const timerEl = document.getElementById("downtime-timer");
    const btnText = document.getElementById("btn-toggle-downtime-text");
    const btnIcon = document.getElementById("btn-toggle-downtime-icon");
    const btn = document.getElementById("btn-toggle-downtime");

    if (statusText) statusText.innerText = `Line is STOPPED (Reason: ${reason || 'Unscheduled'})`;
    if (statusText) statusText.className = "text-sm font-black text-rose-600 mt-0.5 animate-pulse";
    if (btnText) btnText.innerText = "END DOWNTIME";
    if (btnIcon) btnIcon.innerText = "🟢";
    if (btn) btn.className = "w-full sm:w-auto px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-sm rounded-xl shadow-md transition flex items-center justify-center space-x-2";

    if (state.downtimeTimerInterval) clearInterval(state.downtimeTimerInterval);

    function formatTime(s) {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    if (timerEl) {
        timerEl.innerText = formatTime(elapsedSecs);
        timerEl.className = "text-2xl font-black mono text-rose-600 mt-1";
    }

    state.downtimeTimerInterval = setInterval(() => {
        elapsedSecs++;
        if (timerEl) timerEl.innerText = formatTime(elapsedSecs);
    }, 1000);
}

function stopDowntimeTimerDisplay() {
    state.activeDowntime = null;
    if (state.downtimeTimerInterval) clearInterval(state.downtimeTimerInterval);

    const statusText = document.getElementById("downtime-status-text");
    const timerEl = document.getElementById("downtime-timer");
    const btnText = document.getElementById("btn-toggle-downtime-text");
    const btnIcon = document.getElementById("btn-toggle-downtime-icon");
    const btn = document.getElementById("btn-toggle-downtime");

    if (statusText) statusText.innerText = "Line is currently RUNNING";
    if (statusText) statusText.className = "text-sm font-black text-slate-700 mt-0.5";
    if (timerEl) {
        timerEl.innerText = "00:00:00";
        timerEl.className = "text-2xl font-black mono text-slate-400 mt-1";
    }
    if (btnText) btnText.innerText = "START DOWNTIME";
    if (btnIcon) btnIcon.innerText = "🔴";
    if (btn) btn.className = "w-full sm:w-auto px-6 py-3.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black text-sm rounded-xl shadow-md transition flex items-center justify-center space-x-2";
}

async function handleDowntimeToggle() {
    if (state.activeDowntime) {
        // Stop downtime
        try {
            const res = await fetch(apiUrl("/api/downtime/stop"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify({ id: state.activeDowntime.id })
            });
            const data = await res.json();
            stopDowntimeTimerDisplay();
            showToast(data.message || "Downtime ended");
        } catch (e) {
            if (!navigator.onLine || e instanceof TypeError) {
                showToast("📴 Offline – downtime stop requires connectivity. Please stop when back online.", true);
            } else {
                showToast("Error stopping downtime", true);
            }
        }
    } else {
        // Start downtime
        const reason = prompt("Enter downtime reason (or leave blank for Unscheduled Stoppage):", "Unscheduled Stoppage");
        if (reason === null) return;

        try {
            const res = await fetch(apiUrl("/api/downtime/start"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify({ reason: reason || "Unscheduled Stoppage" })
            });
            const data = await res.json();
            startDowntimeTimer(0, data.downtime_id, reason);
            showToast("Downtime tracking started");
        } catch (e) {
            if (!navigator.onLine || e instanceof TypeError) {
                showToast("📴 Offline – downtime tracking requires connectivity. Use manual entry form when back online.", true);
            } else {
                showToast("Error starting downtime", true);
            }
        }
    }
}

function toggleManualDowntimeSection() {
    const form = document.getElementById("downtime-manual-form");
    if (form) form.classList.toggle("hidden");
}

async function submitManualDowntime() {
    const start = document.getElementById("manual-dt-start").value;
    const end = document.getElementById("manual-dt-end").value;
    const reason = document.getElementById("manual-dt-reason").value.trim() || "Manual Stoppage Entry";

    if (!start || !end) {
        showToast("Please enter both start and finish time", true);
        return;
    }

    const _dtHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
    };
    const _dtBody = JSON.stringify({
        date:       state.currentDate,
        start_time: start,
        end_time:   end,
        reason:     reason
    });

    try {
        const res = await fetch(apiUrl("/api/downtime/manual"), {
            method:  "POST",
            headers: _dtHeaders,
            body:    _dtBody
        });

        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Failed to log downtime", true);
            return;
        }

        const data = await res.json();
        showToast(data.message || "Downtime recorded");
        toggleManualDowntimeSection();
    } catch (e) {
        // Network failure – save locally and auto-upload when back online
        if (!navigator.onLine || e instanceof TypeError) {
            if (window.OfflineQueue) {
                await window.OfflineQueue.enqueue({
                    endpoint: apiUrl("/api/downtime/manual"),
                    method:   "POST",
                    headers:  _dtHeaders,
                    body:     _dtBody,
                    label:    `Manual downtime – ${state.currentDate} ${start}–${end} (${reason})`
                });
                showToast("📴 Offline – downtime entry saved locally. Will auto-upload when back online.");
                toggleManualDowntimeSection();
            } else {
                showToast("Error recording manual downtime", true);
            }
        } else {
            showToast("Error recording manual downtime", true);
        }
    }
}


// ==========================================
// 5. FLEXIBLE OPERATOR SUBMISSION
// ==========================================

async function submitFlexibleOperatorData() {
    if (!state.user) return;
    const hourSlot = parseInt(document.getElementById("op-hour-select").value);
    
    const payload = {
        date: state.currentDate,
        hour_slot: hourSlot
    };

    function getFloatVal(id) {
        const el = document.getElementById(id);
        return el && el.value !== "" ? parseFloat(el.value) : null;
    }
    function getIntVal(id) {
        const el = document.getElementById(id);
        return el && el.value !== "" ? parseInt(el.value) : null;
    }

    payload.cooker_brix = getFloatVal("op-cooker-brix");
    payload.cooker_setpoint_brix = getFloatVal("op-cooker-setpoint");
    payload.filler_brix = getFloatVal("op-filler-brix");
    payload.final_product_brix = getFloatVal("op-final-brix");

    payload.cooker_temp = getFloatVal("op-cooker-temp");
    payload.filler_temp = getFloatVal("op-filler-temp");
    payload.final_temp = getFloatVal("op-final-temp");

    payload.raw_barrels_count = getIntVal("op-raw-barrels");
    payload.can_filler_cans_count = getIntVal("op-can-count");
    payload.universal_packets_count = getIntVal("op-packet-count");
    payload.can_pallets_count = getFloatVal("op-can-pallets");
    payload.packet_pallets_count = getFloatVal("op-packet-pallets");

    const _submitHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
    };

    try {
        const res = await fetch(apiUrl("/api/logs/flexible-submit"), {
            method: "POST",
            headers: _submitHeaders,
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Submission failed", true);
            return;
        }

        const data = await res.json();
        const badge = data.timeliness_status === "ON_TIME" ? "🟢 ON TIME" : `🟡 LATE (+${data.minutes_past_hour}m)`;
        showToast(`${data.message} [${badge}]`);
        loadRecentSubmissionsForOperator();
    } catch (e) {
        // Network failure – save locally and auto-upload when back online
        if (!navigator.onLine || e instanceof TypeError) {
            if (window.OfflineQueue) {
                await window.OfflineQueue.enqueue({
                    endpoint: apiUrl("/api/logs/flexible-submit"),
                    method:   "POST",
                    headers:  _submitHeaders,
                    body:     JSON.stringify(payload),
                    label:    `Operator readings – ${payload.date} ${String(hourSlot).padStart(2, '0')}:00`
                });
                showToast("📴 Offline – reading saved locally. Will auto-upload when back online.");
            } else {
                showToast("Offline – could not save reading (reload the app to enable offline mode).", true);
            }
        } else {
            showToast("Error submitting log", true);
        }
    }
}

async function loadRecentSubmissionsForOperator() {
    const listEl = document.getElementById("op-recent-submissions-list");
    if (!listEl) return;

    try {
        const res = await fetch(apiUrl(`/api/moderator/audits?date=${state.currentDate}`), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;
        const audits = await res.json();
        const myAudits = audits.filter(a => a.user_id === state.user.id).slice(0, 5);

        if (myAudits.length === 0) {
            listEl.innerHTML = `<div class="p-3 bg-slate-50 rounded-2xl text-center text-xs text-slate-400">No logs submitted yet today.</div>`;
            return;
        }

        listEl.innerHTML = myAudits.map(a => {
            const statusClass = a.status === "ON_TIME" 
                ? "bg-morouj-green-light text-morouj-forest border-morouj-green/40" 
                : "bg-morouj-orange-light text-morouj-orange-dark border-morouj-orange/40";
            return `
                <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                    <div>
                        <div class="font-bold text-morouj-forest">${a.hour_label} Slot</div>
                        <div class="text-xs text-slate-500 font-semibold">${a.metric_value}</div>
                    </div>
                    <span class="text-[11px] font-extrabold px-2.5 py-1 rounded-xl border ${statusClass}">
                        ${a.status === "ON_TIME" ? "✓ ON TIME" : `LATE (+${a.minutes_past_hour}m)`}
                    </span>
                </div>
            `;
        }).join("");
    } catch (e) {}
}


// ==========================================
// 6. MANAGEMENT DASHBOARD (CONFIGURABLE VIEWS)
// ==========================================

async function loadManagementDashboard() {
    const dateInput = document.getElementById("mgmt-date-picker");
    const selectedDate = dateInput ? dateInput.value : state.currentDate;

    try {
        const url = apiUrl(`/api/analytics/daily?date=${selectedDate}&barrel_price_sdg=${state.barrelPriceSDG}`);
        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });

        if (!res.ok) {
            showToast("Failed to fetch analytics", true);
            return;
        }

        const data = await res.json();
        const perms = state.user?.permissions || {};

        renderKPIs(data, perms);
        applyManagementVisibility(perms);
        renderManagementCharts(data, perms);
        renderDowntimeEventsTable(data.downtime_events);
    } catch (err) {
        showToast("Error loading management metrics", true);
    }
}

function renderKPIs(data, perms) {
    // Brix
    document.getElementById("kpi-avg-brix").innerText = data.day_average_brix ? `${data.day_average_brix}° Bx` : "-- °Bx";
    
    // Temperatures
    document.getElementById("kpi-avg-cooker-temp").innerText = data.day_average_cooker_temp ? `${data.day_average_cooker_temp}° C` : "-- °C";
    document.getElementById("kpi-avg-filler-temp").innerText = `Filler: ${data.day_average_filler_temp || '--'}°C`;

    // Downtime
    document.getElementById("kpi-total-downtime").innerText = `${data.total_downtime_minutes} min`;
    document.getElementById("kpi-downtime-events-count").innerText = `${data.downtime_events.length} Stoppages Logged`;

    // Product Produced
    document.getElementById("kpi-product-produced").innerText = `${data.total_product_produced_kg.toLocaleString()} kg`;
    document.getElementById("kpi-pallets-breakdown").innerText = `${data.total_can_pallets} Can / ${data.total_packet_pallets} Pkt Pallets`;

    // Raw Used
    const rawEl = document.getElementById("kpi-raw-used");
    if (rawEl) rawEl.innerText = `${data.total_raw_material_used_kg.toLocaleString()} kg`;
    const bblEl = document.getElementById("kpi-raw-barrels-count");
    if (bblEl) bblEl.innerText = `${data.total_raw_barrels} Barrels (37° Bx)`;

    // Raw Wasted
    const wasteEl = document.getElementById("kpi-raw-wasted");
    if (wasteEl) wasteEl.innerText = `${data.total_raw_material_wasted_kg.toLocaleString()} kg`;

    // Capital Wasted
    const capEl = document.getElementById("kpi-capital-wasted");
    if (capEl) capEl.innerText = `${Math.round(data.total_capital_wasted_sdg).toLocaleString()} SDG`;
}

function applyManagementVisibility(perms) {
    function toggleEl(id, isVisible) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("hidden", !isVisible);
    }

    // KPI / Summary Info Boxes
    toggleEl("kpi-box-avg-brix", perms.kpi_avg_brix !== false);
    toggleEl("kpi-box-avg-temp", perms.kpi_avg_temperature !== false);
    toggleEl("kpi-box-downtime", perms.kpi_total_downtime !== false);
    toggleEl("kpi-box-product", perms.kpi_product_produced !== false);
    toggleEl("kpi-box-raw-used", !!perms.kpi_raw_used);
    toggleEl("kpi-box-raw-wasted", !!perms.kpi_raw_wasted);
    toggleEl("kpi-box-capital-wasted", !!perms.kpi_capital_wasted);

    // Charts
    toggleEl("wrapper-chart-concentration", perms.chart_concentration !== false);
    toggleEl("wrapper-chart-temperature", perms.chart_temperature !== false);
    toggleEl("wrapper-chart-downtime", perms.chart_downtime !== false);
    toggleEl("wrapper-chart-raw-used", !!perms.chart_raw_used);
    toggleEl("wrapper-chart-product-produced", !!perms.chart_product_produced);
    toggleEl("wrapper-chart-raw-wasted", !!perms.chart_raw_wasted);
    toggleEl("wrapper-chart-capital-wasted", !!perms.chart_capital_wasted);

    // Tables & Controls
    toggleEl("wrapper-table-downtime", perms.table_downtime_log !== false);
    toggleEl("mgmt-export-controls", perms.export_buttons !== false);
}

function renderManagementCharts(data, perms) {
    const hours = data.hourly_metrics.filter(h => 
        h.cooker_brix > 0 || h.filler_brix > 0 || h.final_brix > 0 || 
        h.cooker_temp > 0 || h.downtime_minutes > 0 || (h.hour_slot >= 7 && h.hour_slot <= 18)
    );
    const labels = hours.map(h => `${String(h.hour_slot).padStart(2, '0')}:00`);

    // 1. CONCENTRATION PROFILE CHART
    const ctx1 = document.getElementById("chart-concentration-profile");
    if (ctx1 && perms.chart_concentration !== false) {
        if (state.charts.concentration) state.charts.concentration.destroy();
        state.charts.concentration = new Chart(ctx1, {
            type: "line",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Cooker Brix",
                        data: hours.map(h => h.cooker_brix),
                        borderColor: "#F15A24", // Morouj Orange
                        backgroundColor: "rgba(241, 90, 36, 0.1)",
                        pointRadius: 4,
                        borderWidth: 2.5
                    },
                    {
                        label: "Cooker Setpoint Brix",
                        data: hours.map(h => h.cooker_setpoint_brix),
                        borderColor: "#FBB03B", // Morouj Gold
                        borderDash: [5, 5],
                        pointRadius: 3,
                        borderWidth: 2
                    },
                    {
                        label: "Filler Brix",
                        data: hours.map(h => h.filler_brix),
                        borderColor: "#48A635", // Morouj Green
                        pointRadius: 4,
                        borderWidth: 2.5
                    },
                    {
                        label: "Final Product Brix",
                        data: hours.map(h => h.final_brix),
                        borderColor: "#133E33", // Morouj Forest
                        pointRadius: 5,
                        borderWidth: 3
                    },
                    {
                        label: "Standard Target 25.5°",
                        data: hours.map(() => 25.5),
                        borderColor: "#E11D48",
                        borderDash: [8, 4],
                        pointRadius: 0,
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 23, max: 32, title: { display: true, text: "Degrees Brix (°Bx)", font: { weight: 'bold' } } }
                }
            }
        });
    }

    // 2. TEMPERATURE PROFILE CHART
    const ctx2 = document.getElementById("chart-temperature-profile");
    if (ctx2 && perms.chart_temperature !== false) {
        if (state.charts.temperature) state.charts.temperature.destroy();
        state.charts.temperature = new Chart(ctx2, {
            type: "line",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Cooker Temp (°C)",
                        data: hours.map(h => h.cooker_temp),
                        borderColor: "#D44413", // Deep Orange
                        backgroundColor: "rgba(212, 68, 19, 0.1)",
                        borderWidth: 3,
                        pointRadius: 4
                    },
                    {
                        label: "Filler Temp (°C)",
                        data: hours.map(h => h.filler_temp),
                        borderColor: "#FBB03B", // Gold
                        borderWidth: 2.5,
                        pointRadius: 4
                    },
                    {
                        label: "Final Product Temp (°C)",
                        data: hours.map(h => h.final_temp),
                        borderColor: "#48A635", // Green
                        borderWidth: 2.5,
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 30, max: 105, title: { display: true, text: "Temperature (°C)", font: { weight: 'bold' } } }
                }
            }
        });
    }

    // 3. DOWNTIME ANALYSIS CHART
    const ctx3 = document.getElementById("chart-downtime-analysis");
    if (ctx3 && perms.chart_downtime !== false) {
        if (state.charts.downtime) state.charts.downtime.destroy();
        state.charts.downtime = new Chart(ctx3, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Downtime (Minutes / Hour)",
                    data: hours.map(h => h.downtime_minutes),
                    backgroundColor: "rgba(225, 29, 72, 0.8)",
                    borderColor: "#BE123C",
                    borderWidth: 1.5,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 60, title: { display: true, text: "Minutes", font: { weight: 'bold' } } }
                }
            }
        });
    }

    // Optional Chart: Raw Used
    const ctxRaw = document.getElementById("chart-raw-used");
    if (ctxRaw && perms.chart_raw_used) {
        if (state.charts.rawUsed) state.charts.rawUsed.destroy();
        state.charts.rawUsed = new Chart(ctxRaw, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Raw Paste Used (kg)",
                    data: hours.map(h => h.raw_material_used_kg),
                    backgroundColor: "rgba(241, 90, 36, 0.85)",
                    borderColor: "#D44413",
                    borderWidth: 1.5,
                    borderRadius: 8
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // Optional Chart: Product Produced
    const ctxProd = document.getElementById("chart-product-produced");
    if (ctxProd && perms.chart_product_produced) {
        if (state.charts.productProduced) state.charts.productProduced.destroy();
        state.charts.productProduced = new Chart(ctxProd, {
            type: "line",
            data: {
                labels: labels,
                datasets: [{
                    label: "Total Product (kg)",
                    data: hours.map(h => h.total_product_produced_kg),
                    borderColor: "#48A635",
                    backgroundColor: "rgba(72, 166, 53, 0.1)",
                    fill: true
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // Optional Chart: Raw Wasted
    const ctxWaste = document.getElementById("chart-raw-wasted");
    if (ctxWaste && perms.chart_raw_wasted) {
        if (state.charts.rawWasted) state.charts.rawWasted.destroy();
        state.charts.rawWasted = new Chart(ctxWaste, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Raw Paste Wasted (kg)",
                    data: hours.map(h => h.raw_material_wasted_kg),
                    backgroundColor: "rgba(212, 68, 19, 0.85)"
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // Optional Chart: Capital Wasted
    const ctxCap = document.getElementById("chart-capital-wasted");
    if (ctxCap && perms.chart_capital_wasted) {
        if (state.charts.capitalWasted) state.charts.capitalWasted.destroy();
        state.charts.capitalWasted = new Chart(ctxCap, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: `Capital Loss in SDG (@ ${state.barrelPriceSDG.toLocaleString()} SDG/bbl)`,
                    data: hours.map(h => h.capital_wasted_sdg),
                    backgroundColor: "rgba(19, 62, 51, 0.85)"
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

function renderDowntimeEventsTable(events) {
    const tbody = document.getElementById("mgmt-downtime-table-body");
    if (!tbody) return;

    if (!events || events.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No downtime events recorded today.</td></tr>`;
        return;
    }

    tbody.innerHTML = events.map(e => `
        <tr class="hover:bg-slate-50">
            <td class="p-3 font-mono font-bold text-slate-700">${new Date(e.start_time).toLocaleTimeString()}</td>
            <td class="p-3 font-mono text-slate-500">${e.end_time ? new Date(e.end_time).toLocaleTimeString() : '<span class="text-rose-600 font-bold">Running</span>'}</td>
            <td class="p-3 font-black text-rose-600">${e.duration_minutes} min</td>
            <td class="p-3 font-semibold">${e.user_name}</td>
            <td class="p-3 font-medium text-slate-800">${e.reason || 'Unscheduled'}</td>
        </tr>
    `).join("");
}

function exportData(format) {
    const dateInput = document.getElementById("mgmt-date-picker");
    const selectedDate = dateInput ? dateInput.value : state.currentDate;
    window.open(apiUrl(`/api/analytics/export?date=${selectedDate}&format=${format}`), "_blank");
}


// ==========================================
// 7. MODERATOR DASHBOARD CONTROLLERS
// ==========================================

function switchModTab(tabName) {
    const tabs = ["users", "compliance", "audits", "settings"];
    tabs.forEach(t => {
        const el = document.getElementById(`mod-tab-${t}`);
        const btn = document.getElementById(`mod-tab-btn-${t}`);
        if (el) el.classList.toggle("hidden", t !== tabName);
        if (btn) {
            btn.className = t === tabName 
                ? "px-3 py-1.5 rounded-xl font-bold text-xs bg-morouj-forest text-white shadow"
                : "px-3 py-1.5 rounded-xl font-bold text-xs bg-slate-100 text-slate-700 hover:bg-slate-200";
        }
    });
    lucide.createIcons();
}

function handleRoleTypeChange(role) {
    const opSec = document.getElementById("modal-operator-permissions");
    const mgmtSec = document.getElementById("modal-management-permissions");
    const modSec = document.getElementById("modal-moderator-permissions");

    if (opSec) opSec.classList.toggle("hidden", role !== "operator");
    if (mgmtSec) mgmtSec.classList.toggle("hidden", role !== "management");
    if (modSec) modSec.classList.toggle("hidden", role !== "moderator");
}

async function loadModeratorUsers() {
    const tbody = document.getElementById("mod-users-table-body");
    if (!tbody) return;

    try {
        const res = await fetch(apiUrl("/api/users"), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;
        const users = await res.json();

        tbody.innerHTML = users.map(u => {
            const perms = u.permissions || {};
            const activePermLabels = Object.keys(perms)
                .filter(k => perms[k])
                .map(k => {
                    const label = k.replace(/^(perm_|kpi_|chart_|table_)/, '').replace(/_/g, ' ');
                    return `<span class="px-2 py-0.5 bg-morouj-green-light text-morouj-forest rounded-md text-[10px] font-bold border border-morouj-green/20 uppercase">${label}</span>`;
                })
                .join(" ");

            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3">
                        <div class="font-bold text-morouj-forest">${u.full_name}</div>
                        <div class="text-xs text-slate-400 font-mono">@${u.username}</div>
                    </td>
                    <td class="p-3"><span class="px-2.5 py-0.5 bg-slate-100 rounded-lg text-slate-700 font-bold uppercase text-[11px]">${u.role}</span></td>
                    <td class="p-3 font-mono font-bold text-morouj-orange-dark">${u.pin_code || "••••"}</td>
                    <td class="p-3 max-w-xs">
                        <div class="flex flex-wrap gap-1">${activePermLabels || '<span class="text-slate-400 text-xs">Standard Default</span>'}</div>
                    </td>
                    <td class="p-3">
                        <span class="px-2.5 py-0.5 rounded-lg text-xs font-bold ${u.is_active ? 'bg-morouj-green-light text-morouj-forest' : 'bg-rose-100 text-rose-800'}">
                            ${u.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="p-3 text-right space-x-1">
                        <button onclick='openEditUserModal(${JSON.stringify(u)})' class="px-3 py-1 text-xs font-bold text-morouj-forest bg-morouj-green-light hover:bg-morouj-green/20 rounded-xl transition">
                            Edit Toggles
                        </button>
                        <button onclick="toggleUserStatus(${u.id}, ${!u.is_active})" class="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition">
                            ${u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (e) {}
}

function openCreateUserModal() {
    document.getElementById("user-modal-title").innerText = "Add New Plant User";
    document.getElementById("edit-user-id").value = "";
    document.getElementById("new-user-fullname").value = "";
    document.getElementById("new-user-username").value = "";
    document.getElementById("new-user-username").disabled = false;
    document.getElementById("new-user-password").value = "password123";
    document.getElementById("new-user-pin").value = "";
    
    const roleSelect = document.getElementById("new-user-role");
    roleSelect.value = "operator";
    handleRoleTypeChange("operator");

    // Uncheck operator perms
    OPERATOR_PERM_KEYS.forEach(k => {
        const chk = document.getElementById(`perm-${k.replace(/_/g, '-')}`);
        if (chk) chk.checked = false;
    });

    // Uncheck management perms
    MANAGEMENT_PERM_KEYS.forEach(k => {
        const chk = document.getElementById(`perm-${k.replace(/_/g, '-')}`);
        if (chk) chk.checked = false;
    });

    document.getElementById("modal-create-user").classList.remove("hidden");
}

function openEditUserModal(u) {
    document.getElementById("user-modal-title").innerText = `Edit Toggles for ${u.full_name}`;
    document.getElementById("edit-user-id").value = u.id;
    document.getElementById("new-user-fullname").value = u.full_name;
    document.getElementById("new-user-username").value = u.username;
    document.getElementById("new-user-username").disabled = false;
    document.getElementById("new-user-password").value = "";
    document.getElementById("new-user-pin").value = u.pin_code || "";
    
    const roleSelect = document.getElementById("new-user-role");
    roleSelect.value = u.role;
    handleRoleTypeChange(u.role);

    const perms = u.permissions || {};

    if (u.role === "operator") {
        OPERATOR_PERM_KEYS.forEach(k => {
            const chk = document.getElementById(`perm-${k.replace(/_/g, '-')}`);
            if (chk) chk.checked = !!perms[k];
        });
    } else if (u.role === "management") {
        MANAGEMENT_PERM_KEYS.forEach(k => {
            const chk = document.getElementById(`perm-${k.replace(/_/g, '-')}`);
            if (chk) chk.checked = perms[k] !== undefined ? !!perms[k] : true;
        });
    }

    document.getElementById("modal-create-user").classList.remove("hidden");
}

function closeCreateUserModal() {
    document.getElementById("modal-create-user").classList.add("hidden");
}

async function handleSaveUser(e) {
    e.preventDefault();
    const userId = document.getElementById("edit-user-id").value;
    const role = document.getElementById("new-user-role").value;

    const permissions = {};
    if (role === "operator") {
        OPERATOR_PERM_KEYS.forEach(k => {
            const chk = document.getElementById(`perm-${k.replace(/_/g, '-')}`);
            if (chk) permissions[k] = chk.checked;
        });
    } else if (role === "management") {
        MANAGEMENT_PERM_KEYS.forEach(k => {
            const chk = document.getElementById(`perm-${k.replace(/_/g, '-')}`);
            if (chk) permissions[k] = chk.checked;
        });
    }

    const payload = {
        username: document.getElementById("new-user-username").value.trim(),
        full_name: document.getElementById("new-user-fullname").value.trim(),
        role: role,
        pin_code: document.getElementById("new-user-pin").value.trim(),
        permissions: permissions
    };
    const originalUsername = state.user ? state.user.username : null;

    const pwd = document.getElementById("new-user-password").value;
    if (pwd) payload.password = pwd;

    try {
        let res;
        if (userId) {
            // Update
            res = await fetch(apiUrl(`/api/users/${userId}`), {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            payload.username = document.getElementById("new-user-username").value.trim();
            payload.password = pwd || "password123";
            payload.is_active = true;

            res = await fetch(apiUrl("/api/users"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify(payload)
            });
        }

        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error saving user", true);
            return;
        }

        // If updated the currently logged-in user, refresh local session permissions
        if (state.user && (state.user.id == userId || state.user.username === payload.username)) {
            state.user.permissions = permissions;
            state.user.full_name = payload.full_name;
            localStorage.setItem("morouj_user", JSON.stringify(state.user));

            // If the moderator renamed themselves, the JWT (bound to the old
            // username) is now invalid - force a fresh re-login.
            if (userId && payload.username && payload.username !== originalUsername) {
                showToast("Username changed - please sign in again");
                closeCreateUserModal();
                setTimeout(() => handleLogout(), 800);
                return;
            }
        }

        closeCreateUserModal();
        loadModeratorUsers();
        showToast("User and role-specific permissions updated successfully!");
    } catch (e) {
        showToast("Network error saving user", true);
    }
}

function openChangePasswordModal() {
    const modal = document.getElementById("change-password-modal");
    if (!modal) {
        alert("Please set a new password before continuing.");
        handleLogout();
        return;
    }
    modal.classList.remove("hidden");
    document.getElementById("change-password-current").value = "";
    document.getElementById("change-password-new").value = "";
    document.getElementById("change-password-confirm").value = "";
    document.getElementById("change-password-new").focus();
}

async function handleChangePassword(e) {
    e.preventDefault();
    const current = document.getElementById("change-password-current").value.trim();
    const newPwd = document.getElementById("change-password-new").value;
    const confirmPwd = document.getElementById("change-password-confirm").value;

    if (!state.user || !state.user.id) return;

    if (newPwd.length < 8) {
        showToast("New password must be at least 8 characters", true);
        return;
    }
    if (newPwd !== confirmPwd) {
        showToast("New password and confirmation do not match", true);
        return;
    }

    try {
        const verifyRes = await fetch(apiUrl(`/api/auth/login`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: state.user.username, password: current })
        });
        if (!verifyRes.ok) {
            showToast("Current password is incorrect", true);
            return;
        }

        const res = await fetch(apiUrl(`/api/users/${state.user.id}`), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ password: newPwd, must_change_password: false })
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Failed to update password", true);
            return;
        }

        const updated = await res.json();
        if (state.user) {
            state.user.must_change_password = false;
            localStorage.setItem("morouj_user", JSON.stringify(state.user));
        }

        const modal = document.getElementById("change-password-modal");
        if (modal) modal.classList.add("hidden");
        showToast("Password updated successfully");
    } catch (e) {
        showToast("Network error updating password", true);
    }
}

async function toggleUserStatus(userId, newActive) {
    try {
        await fetch(apiUrl(`/api/users/${userId}`), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ is_active: newActive })
        });
        loadModeratorUsers();
        showToast("User status updated");
    } catch (e) {}
}

async function loadModeratorCompliance() {
    const tbody = document.getElementById("mod-compliance-table-body");
    if (!tbody) return;

    try {
        const res = await fetch(apiUrl(`/api/moderator/compliance?date=${state.currentDate}`), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;
        const rows = await res.json();
        const shiftRows = rows.filter(r => r.hour_slot >= 7 && r.hour_slot <= 18);

        tbody.innerHTML = shiftRows.map(r => {
            const cells = r.roles.map(role => {
                let badge = "";
                if (role.status === "ON_TIME") {
                    badge = `<span class="px-2.5 py-1 bg-morouj-green-light text-morouj-forest rounded-lg font-bold">🟢 On Time</span>`;
                } else if (role.status === "LATE") {
                    badge = `<span class="px-2.5 py-1 bg-morouj-orange-light text-morouj-orange-dark rounded-lg font-bold">🟡 Late (+${role.minutes_past_hour}m)</span>`;
                } else if (role.status === "MISSING") {
                    badge = `<span class="px-2.5 py-1 bg-rose-100 text-rose-800 rounded-lg font-bold">🔴 Overdue / Missing</span>`;
                } else {
                    badge = `<span class="px-2.5 py-1 bg-slate-100 text-slate-400 rounded-lg">⚪ Pending</span>`;
                }
                return `<td class="p-3">${badge}</td>`;
            }).join("");

            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 font-extrabold text-morouj-forest">${r.hour_label}</td>
                    ${cells}
                </tr>
            `;
        }).join("");
    } catch (e) {}
}

async function loadModeratorAudits() {
    const tbody = document.getElementById("mod-audits-table-body");
    if (!tbody) return;

    try {
        const res = await fetch(apiUrl(`/api/moderator/audits?date=${state.currentDate}`), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;
        const audits = await res.json();

        tbody.innerHTML = audits.map(a => {
            const timeStr = new Date(a.submission_timestamp).toLocaleTimeString();
            const statusClass = a.status === "ON_TIME" 
                ? "bg-morouj-green-light text-morouj-forest" 
                : a.status === "LATE" 
                ? "bg-morouj-orange-light text-morouj-orange-dark"
                : "bg-morouj-gold-light text-morouj-forest";
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 font-mono text-slate-500">${timeStr}</td>
                    <td class="p-3 font-bold">${a.hour_label}</td>
                    <td class="p-3 font-black text-morouj-forest">${a.user_name}</td>
                    <td class="p-3 text-slate-600">${a.role}</td>
                    <td class="p-3 font-semibold text-slate-800 max-w-sm truncate">${a.metric_value}</td>
                    <td class="p-3">
                        <span class="px-2.5 py-1 rounded-xl text-[11px] font-extrabold ${statusClass}">
                            ${a.status} (${a.minutes_past_hour}m)
                        </span>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (e) {}
}

async function loadPlantSettings() {
    try {
        const res = await fetch(apiUrl("/api/settings"), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;
        const settings = await res.json();
        settings.forEach(s => {
            if (s.key === "barrel_weight_kg") document.getElementById("setting-barrel-weight").value = s.value;
            if (s.key === "raw_brix") document.getElementById("setting-raw-brix").value = s.value;
            if (s.key === "target_brix") document.getElementById("setting-target-brix").value = s.value;
            if (s.key === "barrel_price_sdg") document.getElementById("setting-barrel-price").value = s.value;
        });
    } catch (e) {}
}

async function handleSaveSettings(e) {
    e.preventDefault();
    const settings = [
        { key: "barrel_weight_kg", value: document.getElementById("setting-barrel-weight").value },
        { key: "raw_brix", value: document.getElementById("setting-raw-brix").value },
        { key: "target_brix", value: document.getElementById("setting-target-brix").value },
        { key: "barrel_price_sdg", value: document.getElementById("setting-barrel-price").value }
    ];

    try {
        for (const s of settings) {
            await fetch(apiUrl(`/api/settings/${s.key}`), {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify({ value: s.value })
            });
        }
        showToast("Plant constants updated successfully!");
    } catch (e) {
        showToast("Error saving plant parameters", true);
    }
}


// ==========================================
// 8. UTILITY NOTIFICATIONS
// ==========================================

function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    const icon = document.getElementById("toast-icon");
    const msg = document.getElementById("toast-message");

    if (!toast) return;
    icon.innerText = isError ? "⚠️" : "✓";
    msg.innerText = message;
    toast.className = isError 
        ? "fixed bottom-6 right-6 z-50 transform transition-all duration-300 max-w-sm w-full bg-rose-900 text-white p-4 rounded-2xl shadow-2xl border border-rose-700 flex items-center space-x-3"
        : "fixed bottom-6 right-6 z-50 transform transition-all duration-300 max-w-sm w-full bg-morouj-forest text-white p-4 rounded-2xl shadow-2xl border border-morouj-forest-light flex items-center space-x-3";

    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4000);
}


// ==========================================
// 9. ROLE-BASED WEB PUSH & NOTIFICATIONS
// ==========================================

function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        const btn = document.getElementById("push-toggle-btn");
        if (btn) btn.classList.add("hidden");
        return;
    }

    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        updatePushUI(!!sub);
    } catch (e) {
        console.warn("[Push] Error checking subscription status:", e);
    }
}

function updatePushUI(isSubscribed) {
    const icon = document.getElementById("push-status-icon");
    const text = document.getElementById("push-status-text");
    const btn = document.getElementById("push-toggle-btn");
    if (!btn) return;

    if (isSubscribed) {
        if (icon) icon.innerText = "🔔";
        if (text) text.innerText = "Alerts ON";
        btn.className = "flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-morouj-green/20 text-morouj-lime border border-morouj-lime/40 rounded-xl transition";
    } else {
        if (icon) icon.innerText = "🔕";
        if (text) text.innerText = "Enable Alerts";
        btn.className = "flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-morouj-forest-dark hover:bg-morouj-forest-light text-slate-300 hover:text-white border border-morouj-forest-light rounded-xl transition";
    }
}

async function togglePushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast("Web Push is not supported on this browser.", true);
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        showToast("Notification permission denied. Please allow notifications in site settings.", true);
        return;
    }

    try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();

        if (sub) {
            // Already subscribed -> Unsubscribe
            await fetch(apiUrl("/api/push/unsubscribe"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify({
                    endpoint: sub.endpoint,
                    keys: { p256dh: "", auth: "" }
                })
            });
            await sub.unsubscribe();
            updatePushUI(false);
            showToast("Push notifications disabled for this device");
        } else {
            // Subscribe
            const keyRes = await fetch(apiUrl("/api/push/public-key"));
            const keyData = await keyRes.json();
            const convertedVapidKey = urlB64ToUint8Array(keyData.public_key);

            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            });

            const rawKey = sub.getKey ? sub.getKey('p256dh') : null;
            const key = rawKey ? btoa(String.fromCharCode.apply(null, new Uint8Array(rawKey))) : '';
            const rawAuthSecret = sub.getKey ? sub.getKey('auth') : null;
            const authSecret = rawAuthSecret ? btoa(String.fromCharCode.apply(null, new Uint8Array(rawAuthSecret))) : '';

            const res = await fetch(apiUrl("/api/push/subscribe"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify({
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: key,
                        auth: authSecret
                    },
                    user_agent: navigator.userAgent
                })
            });

            if (!res.ok) {
                showToast("Failed to register subscription on plant server", true);
                return;
            }

            updatePushUI(true);
            showToast(`🔔 Push Alerts enabled for ${state.user.role.toUpperCase()}`);
        }
    } catch (err) {
        console.error("[Push] Subscription error:", err);
        showToast("Error configuring push notifications: " + err.message, true);
    }
}

// ── Operator Shift Mode Logic ─────────────────────────────────

async function loadOperatorShiftMode() {
    if (!state.token || !state.user) return;
    try {
        const res = await fetch(apiUrl("/api/operator/shift-mode"), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (res.ok) {
            const data = await res.json();
            state.user.shift_mode = data.shift_mode || "morning";
            localStorage.setItem("morouj_user", JSON.stringify(state.user));
        }
    } catch (e) {
        console.warn("[Shift] Error loading shift mode:", e);
    }
    updateOperatorShiftUI();
}

async function setOperatorShiftMode(mode) {
    if (!state.token || !state.user) return;
    state.user.shift_mode = mode;
    localStorage.setItem("morouj_user", JSON.stringify(state.user));
    updateOperatorShiftUI();

    try {
        const res = await fetch(apiUrl("/api/operator/shift-mode"), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ shift_mode: mode })
        });
        if (res.ok) {
            showToast(`Shift Mode updated: ${mode === 'morning' ? '☀️ Morning Shift (7 AM - 7 PM)' : '🌙 Night Shift (7 PM - 7 AM)'}`);
        }
    } catch (e) {
        showToast("Saved locally. Network error updating shift mode on server", true);
    }
}

function updateOperatorShiftUI() {
    const shift = (state.user && state.user.shift_mode) ? state.user.shift_mode : "morning";
    const btnM = document.getElementById("btn-shift-morning");
    const btnN = document.getElementById("btn-shift-night");
    const pill = document.getElementById("op-shift-status-pill");

    if (btnM && btnN) {
        if (shift === "morning") {
            btnM.className = "p-3.5 rounded-2xl border-2 transition flex items-center space-x-3.5 text-left border-morouj-green bg-morouj-green/10 text-morouj-forest shadow-sm";
            btnN.className = "p-3.5 rounded-2xl border-2 transition flex items-center space-x-3.5 text-left border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300";
        } else {
            btnM.className = "p-3.5 rounded-2xl border-2 transition flex items-center space-x-3.5 text-left border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300";
            btnN.className = "p-3.5 rounded-2xl border-2 transition flex items-center space-x-3.5 text-left border-purple-600 bg-purple-50 text-purple-900 shadow-sm";
        }
    }

    if (pill) {
        const curHour = new Date().getHours();
        const onShift = shift === "morning" ? (curHour >= 7 && curHour < 19) : (curHour >= 19 || curHour < 7);
        if (onShift) {
            pill.className = "text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300";
            pill.innerText = "Active On-Shift • Reminders Enabled";
        } else {
            pill.className = "text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300";
            pill.innerText = "Off-Shift • Reminders Paused";
        }
    }
}

async function testOperatorPushReminder() {
    if (!state.token) return;
    try {
        const curHour = new Date().getHours();
        const hourStr = `${String(curHour).padStart(2, '0')}:00`;
        const res = await fetch(apiUrl("/api/push/test-notification"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({
                title: "Hourly Reading Reminder",
                body: `Please log your operational readings for ${hourStr}.`
            })
        });

        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Please click 'Push Alerts' in header to subscribe this device first", true);
            return;
        }

        showToast("🔔 Test hourly push reminder dispatched!");
    } catch (e) {
        showToast("Error triggering reminder test", true);
    }
}

let cachedSetpoints = [];
let setpointsCollapsed = false;

function toggleSetpointsCollapse() {
    const grid = document.getElementById("setpoints-editor-grid");
    const chevron = document.getElementById("icon-setpoints-chevron");
    const indicator = document.getElementById("setpoints-collapse-indicator");
    if (!grid) return;

    setpointsCollapsed = !setpointsCollapsed;
    grid.classList.toggle("hidden", setpointsCollapsed);
    if (indicator) indicator.innerText = setpointsCollapsed ? "▶" : "▼";
    if (chevron) chevron.style.transform = setpointsCollapsed ? "rotate(-90deg)" : "rotate(0deg)";
}

async function loadManagerSetpoints() {
    const grid = document.getElementById("setpoints-editor-grid");
    if (!grid || !state.token) return;

    try {
        const res = await fetch(apiUrl("/api/setpoints"), {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) return;

        const allSps = await res.json();
        // Keep only the 6 core metrics (exclude system_pressure)
        cachedSetpoints = allSps.filter(sp => sp.param_key !== "system_pressure");
        renderSetpointsEditor();
    } catch (e) {
        console.warn("[Setpoints] Error loading setpoints:", e);
    }
}

function renderSetpointsEditor() {
    const grid = document.getElementById("setpoints-editor-grid");
    if (!grid) return;
    grid.innerHTML = "";

    cachedSetpoints.forEach((sp) => {
        const isBrix = sp.category === "brix";
        const badgeColor = isBrix 
            ? "bg-morouj-gold-light text-amber-900 border-morouj-gold/40"
            : "bg-morouj-orange-light text-morouj-orange-dark border-morouj-orange/40";
        const icon = isBrix ? "🎯" : "🔥";

        grid.innerHTML += `
            <div class="p-2.5 bg-slate-50 hover:bg-slate-100/70 transition border border-slate-200 rounded-xl space-y-2 shadow-sm">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-1.5 min-w-0">
                        <span class="text-xs">${icon}</span>
                        <div class="min-w-0">
                            <div class="text-xs font-black text-slate-800 truncate">${sp.param_name}</div>
                            <div class="text-[10px] text-slate-400 truncate">${sp.location}</div>
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${badgeColor}">${sp.unit}</span>
                        <div class="text-[9px] font-bold text-slate-400 mt-0.5">Target: ${sp.target_value !== null ? sp.target_value : '--'}</div>
                    </div>
                </div>

                <div class="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs">
                    <div class="flex items-center space-x-1">
                        <span class="text-[10px] font-bold text-slate-400 uppercase">Min</span>
                        <input type="number" step="0.1" id="sp-min-${sp.param_key}" value="${sp.min_value}" class="w-14 text-center font-black py-0.5 border border-slate-300 rounded focus:border-morouj-forest outline-none text-slate-800 text-xs">
                    </div>
                    <span class="text-slate-300 font-bold">→</span>
                    <div class="flex items-center space-x-1">
                        <span class="text-[10px] font-bold text-slate-400 uppercase">Max</span>
                        <input type="number" step="0.1" id="sp-max-${sp.param_key}" value="${sp.max_value}" class="w-14 text-center font-black py-0.5 border border-slate-300 rounded focus:border-morouj-forest outline-none text-slate-800 text-xs">
                    </div>
                </div>
            </div>
        `;
    });
    lucide.createIcons();
}

async function saveManagerSetpoints() {
    if (!state.token) return;

    const payloadList = cachedSetpoints.map(sp => {
        const minEl = document.getElementById(`sp-min-${sp.param_key}`);
        const maxEl = document.getElementById(`sp-max-${sp.param_key}`);
        return {
            ...sp,
            min_value: minEl ? parseFloat(minEl.value) : sp.min_value,
            max_value: maxEl ? parseFloat(maxEl.value) : sp.max_value
        };
    });

    try {
        const res = await fetch(apiUrl("/api/setpoints"), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ setpoints: payloadList })
        });

        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Failed to update setpoints", true);
            return;
        }

        cachedSetpoints = payloadList;
        showToast("🎯 Setpoint parameter ranges & abnormality thresholds saved!");
    } catch (e) {
        showToast("Error updating setpoints", true);
    }
}

async function testManagerAbnormalityAlert() {
    if (!state.token) return;
    try {
        const res = await fetch(apiUrl("/api/setpoints/test-alert?param_key=cooker_brix&simulated_value=32.5"), {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${state.token}`
            }
        });
        if (res.ok) {
            showToast("⚠️ Out-of-Range abnormality test alert dispatched to managers!");
        } else {
            const err = await res.json();
            showToast(err.detail || "Error simulating alert", true);
        }
    } catch (e) {
        showToast("Error simulating alert", true);
    }
}


