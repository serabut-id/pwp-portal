const GAS_URL = 'https://script.google.com/macros/s/AKfycby9BUAzLgACK62SpA35zAb5hQP57CFNOjb2I2xwbb6g3rdYORIhRHcDyw-QuxOPmMQoSA/exec';

function gasGet_(action, params) {
  var url = GAS_URL + '?action=' + action;
  if (params) {
    Object.keys(params).forEach(function(k) {
      url += '&' + k + '=' + encodeURIComponent(params[k]);
    });
  }
  // Cache-busting: paksa GAS kirim response fresh setiap request
  url += '&_t=' + Date.now();
  return fetch(url).then(function(r) { return r.json(); });
}

function gasPost_(action, body) {
  body.action = action;
  return fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); });
}


    // ===== GLOBAL STATE (WAJIB) =====
    let uploadedFile = null;
    let selectedYear = null;     // tahun yang dipilih (string)
    let selectedRate = 0;        // tarif hunian (number)
    let previewObjectUrl = null;   // 🔥 untuk revoke object URL preview
    let activeTabType = 'pending';
    let activePolling = null;
    let uidLoadedRows = new Set();
    let activeTimeFilter = 'all';
    let activeRateFilter = null;
    let currentUser = null;   // { email, role, blocks }
    let wargaPaidMonths = null;
    let wargaPendingMonths = null; // { '2026': [4, 5], '2025': [11] } — bulan yg masih Pending
    let wargaRateByMonth = null; // { '2025': { '2025_0': 200000, '2025_7': 175000 }, ... }
    let userOverrideRateByYear = {}; // { '2025': 175000, '2026': 200000 }
    let selectedMonthsByYear = {}; // { '2025': [6], '2026': [1] }
    let blokToastTimeout = null;
    let activeToastTimer = null;
    let blokSuggestionIndex = -1;
    let currentSuggestions = [];

    // ===== GREETING SVG ICONS =====
    var _GREET_SVG_ = {
      pagi  : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#F59E0B" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
      siang : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#F97316" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
      sore  : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#FB923C" stroke-width="2" viewBox="0 0 24 24"><path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 9v3M12 2v1M4.22 4.22l.7.7M2 12h1M22 12h-1M18.36 5.64l-.7.7"/><path d="M3 18h18" stroke-linecap="round"/></svg>',
      malam : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#818CF8" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    };
    function _getGreetingHTML_(hour) {
      if (hour < 11) return { text: 'Selamat pagi',  svg: _GREET_SVG_.pagi  };
      if (hour < 15) return { text: 'Selamat siang', svg: _GREET_SVG_.siang };
      if (hour < 18) return { text: 'Selamat sore',  svg: _GREET_SVG_.sore  };
      return           { text: 'Selamat malam',       svg: _GREET_SVG_.malam };
    }

    // ===== SESSION PERSIST (7 DAYS) =====
    var SESSION_KEY = 'jps2_session';
    var SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 hari dalam milliseconds

    function saveSession(user) {
      if (!user) return;
      var sessionData = {
        user: user,
        timestamp: Date.now()
      };
      try {
        var raw = JSON.stringify(sessionData);
        localStorage.setItem(SESSION_KEY, raw);
        sessionStorage.setItem(SESSION_KEY, raw);
      } catch(e) {
        console.warn('Gagal menyimpan session:', e);
      }
    }

    function loadSession() {
      try {
        var stored = localStorage.getItem(SESSION_KEY);
        if (!stored) {
          stored = sessionStorage.getItem(SESSION_KEY);
        }
        if (!stored) return null;
        var sessionData = JSON.parse(stored);
        var now = Date.now();
        if (now - sessionData.timestamp > SESSION_TTL) {
          clearSession();
          return null;
        }
        // Refresh timestamp agar tidak expire
        sessionData.timestamp = now;
        var raw = JSON.stringify(sessionData);
        localStorage.setItem(SESSION_KEY, raw);
        sessionStorage.setItem(SESSION_KEY, raw);
        return sessionData.user;
      } catch(e) {
        console.warn('Gagal memuat session:', e);
        return null;
      }
    }

    function clearSession() {
      try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
      } catch(e) {
        console.warn('Gagal menghapus session:', e);
      }
    }

    // ===== RESTORE SESSION ON PAGE LOAD =====
    // Banner selalu load tanpa syarat login
    setTimeout(function() { if (typeof loadHeaderGreeting === 'function') loadHeaderGreeting(); }, 300);

    (function() {
      var restoredUser = loadSession();
      if (restoredUser) {
        currentUser = restoredUser;
        setTimeout(function() {
          updateHeaderAuthUI();
          initNotifications();
          loadHomeData();
          // Fetch ulang wargaData jika belum ada
          if (!currentUser.wargaData || !currentUser.wargaData.length) {
            gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
              .then(function(dataRes) {
                if (dataRes && dataRes.success) {
                  currentUser.wargaData = dataRes.data || [];
                  saveSession(currentUser);
                }
              });
          }
        }, 100);
      }
    })();

    // ===== iOS PWA: re-check session saat app kembali visible =====
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && !currentUser) {
        var restoredUser = loadSession();
        if (restoredUser) {
          currentUser = restoredUser;
          updateHeaderAuthUI();
          loadHomeData();
          if (!currentUser.wargaData || !currentUser.wargaData.length) {
            gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
              .then(function(dataRes) {
                if (dataRes && dataRes.success) {
                  currentUser.wargaData = dataRes.data || [];
                  saveSession(currentUser);
                }
              });
          }
        }
      }
    });

    // ===== SPLASH SCREEN =====
    (function() {
      var splash = document.getElementById('splashScreen');
      if (!splash) return;
      setTimeout(function() {
        splash.style.opacity = '0';
        setTimeout(function() {
          splash.style.display = 'none';
        }, 500);
      }, 3600);
    })();

    const VALID_BLOK_LIST = [
    "A1","A2","A3","A5",
    "B1","B2","B3","B5","B6","B7","B8","B9","B10","B11","B12","B12A",
    "C1","C2","C3","C5","C6","C7","C8","C9","C10","C11","C12","C12A","C15","C16","C17","C18","C19",
    "D1","D2","D3","D5","D6","D7","D8","D9","D10","D11","D12","D12A","D15","D16","D17","D18","D19",
    "D20","D21","D22","D23","D23A","D25","D26","D27","D28","D29","D30","D31","D32","D33","D34","D35","D36","D37",
    "E1","E2","E3","E5","E6","E7","E8","E9","E10","E11","E12","E12A","E15","E16","E17","E18","E19",
    "E20","E21","E22","E23","E23A","E25","E26","E27","E28","E29","E30","E31","E32",
    "F1","F2","F3","F5","F6","F7","F8","F9","F10","F11","F12","F12A",
    "F20","F21","F22","F23","F23A","F25","F26","F27","F28",
    "G1","G2","G3","G5","G6","G7","G8","G9","G10","G11","G12",
    "G14","G15","G16","G17","G18","G19","G20","G21","G22","G23","G24","G25","G26","G27","G28",
    "H1","H2","H3","H5","H6","H7","H8","H9","H10","H11","H12",
    "H14","H15","H16","H17","H18","H19","H20","H21","H22","H23","H24","H25","H26",
    "I1","I2","I3","I5","I6","I7","I8","I9","I10","I11","I12",
    "I14","I15","I16","I17","I18"
    ];

    function getBlokSuggestions(input) {

      const val = input.toUpperCase().trim();

      if (!val) return [];

      const results = VALID_BLOK_LIST
        .filter(b => b.startsWith(val))
        .sort((a,b)=>a.localeCompare(b,'en',{numeric:true}))
        .slice(0,6);

      currentSuggestions = results;
      blokSuggestionIndex = -1;

      return results;
    }

    function updateHeaderAuthUI() {
      const infoEl   = document.getElementById('headerUserInfo');
      const greetEl  = document.getElementById('headerGreeting');
      const greetTxt = document.getElementById('headerGreetingText');
      if (!infoEl) return;

      if (!currentUser) {
        infoEl.classList.add('hidden');
        infoEl.innerText = '';
        // Header tak lagi pakai brand PWP → guest tetap dapat sapaan generik
        if (greetEl && greetTxt) {
          greetTxt.innerHTML = 'Selamat datang <span style="font-size:14px">👋</span>';
          greetEl.classList.remove('hidden');
          greetEl.classList.add('flex');
        }
        _renderHeaderAvatar_();
        updateTarifDisplay_(false);
        updateNavAdminVisibility();
        _updateDesktopSidebarProfile_();
        return;
      }

      infoEl.classList.add('hidden');

      // Tampilkan nama + icon waktu di header
      if (greetEl && greetTxt) {
        var _h = new Date().getHours();
        var _icons = {
          pagi  : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#F59E0B" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
          siang : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#F97316" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
          sore  : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#F97316" stroke-width="2" viewBox="0 0 24 24"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>',
          malam : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#818CF8" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        };
        var _label = _h < 11 ? 'pagi' : _h < 15 ? 'siang' : _h < 18 ? 'sore' : 'malam';
        var _fullName = (currentUser.fullName || currentUser.email || '');
        // icon waktu diganti foto profil di kiri → teks cukup "Sore, Nama"
        greetTxt.innerHTML = (_label.charAt(0).toUpperCase() + _label.slice(1)) + ', ' + _fullName;
        greetEl.classList.remove('hidden');
        greetEl.classList.add('flex');
      }
      _renderHeaderAvatar_();

      updateTarifDisplay_(true);
      updateNavAdminVisibility();
      _updateDesktopSidebarProfile_();
      if (typeof _showDarkModeBtn_ === 'function') _showDarkModeBtn_();
    }

    function updateTarifDisplay_(isLoggedIn, rate, res) {
      renderTarifCards_({ loggedIn: !!isLoggedIn, rate: (rate != null ? rate : null), res: res || null });
    }

    function handleHeaderAuthClick() {
      openPageSaya();
    }

    function shakeField(el){
      if(!el) return;
      el.classList.add('shake');
      setTimeout(()=>{
        el.classList.remove('shake');
      },400);
    }

    function triggerInputError(el){
      if(!el) return;
      // focus field
      el.focus();
      // shake animation
      shakeField(el);
      el.classList.add('error-pulse');
      setTimeout(()=>{
        el.classList.remove('error-pulse');
      },250);
      // haptic feedback (mobile)
      if(navigator.vibrate){
        navigator.vibrate(40);
      }
      // highlight error border
      el.classList.add('border-red-500');
    }

    function setBlokError(msg) {
      const err = document.getElementById('blokError');
      if (!err) return;
      err.innerText = msg;
      err.classList.remove('hidden');
      blokInput.classList.add('border-red-500');
      shakeField(blokInput);
    }

    function clearBlokError(){
      const err = document.getElementById('blokError');
      if (!err) return;
      err.classList.add('hidden');
      err.innerText = '';
      blokInput.classList.remove('border-red-500');
    }

    function highlightBlokSuggestion(index){
      const chips = document.querySelectorAll('.blok-chip');
      chips.forEach(c => c.classList.remove('active'));
      if(chips[index]){
        chips[index].classList.add('active');
      }
    }

    /* ======================================
      PAGE SAYA (LOGIN PAGE REPLACEMENT)
    ====================================== */

  // Avatar color palette — pick by first char code
  var _avatarColors_ = [
    '#3b82f6','#2196F3','#9C27B0','#FF5722','#2563eb',
    '#3F51B5','#E91E63','#FF9800','#607D8B','#795548'
  ];
  function _renderProfileAvatar_(name) {
    var el = document.getElementById('sayaProfileAvatar');
    if (!el) return;
    var avatar = (currentUser && currentUser.avatar) ? currentUser.avatar : '';
    if (avatar) {
      el.style.background = 'transparent';
      el.textContent = '';
      el.innerHTML = '<img src="' + avatar + '" alt="Foto profil" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
      return;
    }
    var initial = (name || '?').trim().charAt(0).toUpperCase();
    var colorIdx = ((name || '').charCodeAt(0) || 0) % _avatarColors_.length;
    el.style.background = _avatarColors_[colorIdx];
    el.innerHTML = '';
    el.textContent = initial;
  }

  // Avatar kecil di header (kiri sapaan) — foto profil / inisial / guest
  function _renderHeaderAvatar_() {
    var el = document.getElementById('headerAvatar');
    if (!el) return;
    if (!currentUser) {
      el.style.background = '#E5E7EB';
      el.innerHTML = '<svg style="width:18px;height:18px" fill="none" stroke="#9CA3AF" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.8-3.5 5-5.5 7.5-5.5S17.7 16.5 19.5 20"/></svg>';
      return;
    }
    var name = currentUser.fullName || currentUser.email || '';
    if (currentUser.avatar) {
      el.style.background = 'transparent';
      el.innerHTML = '<img src="' + currentUser.avatar + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
      return;
    }
    var initial = (name || '?').trim().charAt(0).toUpperCase();
    var colorIdx = ((name || '').charCodeAt(0) || 0) % _avatarColors_.length;
    el.style.background = _avatarColors_[colorIdx];
    el.innerHTML = '';
    el.textContent = initial;
  }

    function openPageSaya() {
      var page = document.getElementById('pageSaya');
      if (!page) return;

      document.body.classList.add('saya-open');
      setActiveNavById('navMe');
      if (!history.state || !history.state.saya) {
        history.pushState({ saya: true }, '');
      }
      switchPage('pageSaya');

      // ===== BELUM LOGIN =====
      if (!currentUser) {
        // Sembunyikan SEMUA step lain (mis. method/OTP/reset yg mungkin masih
        // terbuka dari interaksi sebelumnya) supaya tak menumpuk dgn step email.
        ['sayaStepMethod','sayaStepOTP','sayaStepResetPIN','sayaLoggedInView'].forEach(function(id) {
          var el = document.getElementById(id);
          if (el) { el.classList.add('hidden'); el.style.display = ''; }
        });
        var _seEmail = document.getElementById('sayaStepEmail');
        if (_seEmail) { _seEmail.classList.remove('hidden'); _seEmail.style.display = ''; }
        return;
      }
      // ===== SUDAH LOGIN =====
      document.body.classList.remove('saya-open');
      var _se = document.getElementById('sayaStepEmail');
      if (_se) { _se.classList.add('hidden'); _se.style.display = ''; }
      var _sm = document.getElementById('sayaStepMethod');
      if (_sm) { _sm.classList.add('hidden'); _sm.style.display = ''; }
      var _so = document.getElementById('sayaStepOTP');
      if (_so) { _so.classList.add('hidden'); _so.style.display = ''; }
      var loggedInView = document.getElementById('sayaLoggedInView');
      if (loggedInView) {
        loggedInView.classList.remove('hidden');
        loggedInView.style.display = 'flex';
        loggedInView.style.flexDirection = 'column';
        loggedInView.style.flex = '1';
        loggedInView.style.minHeight = '0';
      }

      // ===== RE-RENDER NAMA & EMAIL =====
      var nameEl  = document.getElementById('sayaProfileName');
      var profEmail = document.getElementById('sayaProfileEmail');
      if (nameEl)    nameEl.innerText  = currentUser.fullName || '';
      if (profEmail) profEmail.innerText = currentUser.email || '';
      _renderProfileAvatar_(currentUser.fullName || '');
      _updateDesktopSidebarProfile_();

      // ===== RE-RENDER BLOK LIST =====
      function renderSayaWargaData_(data) {
        var listEl = document.getElementById('sayaBlokList');
        if (listEl) {
          listEl.innerHTML = '';
          var blokLabels = data
            .map(function(item) { return item.blok || ''; })
            .filter(Boolean)
            .join(', ');
          var div = document.createElement('div');
          div.className = 'text-sm font-medium text-gray-900 mt-0.5';
          div.innerText = blokLabels || '—';
          listEl.appendChild(div);
        }
        var namaEl  = document.getElementById('sayaNamaInput');
        var hpEl    = document.getElementById('sayaHpInput');
        var emailEl = document.getElementById('sayaEmailEditInput');
        var badgeEl = document.getElementById('sayaProfileBlokBadge');
        if (namaEl)    namaEl.value  = data[0].nama  || '';
        if (hpEl)      hpEl.value    = data[0].noHp  || '';
        if (emailEl)   emailEl.value = data[0].email || currentUser.email || '';
        if (badgeEl && data.length) {
          badgeEl.innerText = 'Blok ' + data.map(function(d){ return d.blok; }).join(', ');
        }
      }

      if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
        renderSayaWargaData_(currentUser.wargaData);
      } else if (currentUser && currentUser.email) {
        // Belum ada wargaData di session → fetch
        gasGet_('getCurrentUserDataWarga', { email: currentUser.email }).then(function(wRes) {
          if (!currentUser) return;
          if (!wRes || !wRes.success || !wRes.data || !wRes.data.length) return;
          currentUser.wargaData = wRes.data;
          saveSession(currentUser);
          renderSayaWargaData_(wRes.data);
        });
      }

      // ===== FORCE RESET EDIT MODE (ANTI NYANGKUT) =====
      const namaInput = document.getElementById('sayaNamaInput');
      const hpInput = document.getElementById('sayaHpInput');
      const emailInput = document.getElementById('sayaEmailEditInput');
      const editBtn = document.getElementById('sayaEditBtn');
      const saveBtn = document.getElementById('sayaSaveBtn');
      [namaInput, hpInput].forEach(function(el) {
        if (!el) return;
        el.readOnly = true;
        el.style.borderBottom = '';
        el.style.paddingBottom = '';
      });
      editBtn?.classList.remove('hidden');
      saveBtn?.classList.add('hidden');

      // Jika sudah di page Saya → scroll to top
      var sayaScroll = document.querySelector('#pageSaya .flex-1.overflow-y-auto');
      if (sayaScroll) sayaScroll.scrollTop = 0;
    }

    function openEmailLogin() {
      const area = document.getElementById('emailLoginArea');
      if (!area) return;

      area.classList.remove('hidden');

      const input = document.getElementById('sayaEmailInput');
      if (input) {
        input.focus();
      }
    }

    // ===== DASHBOARD CACHE STATE =====
    let dashboardCache = null;
    let dashboardPendingCache = [];
    let dashboardConfirmedCache = [];
    let dashboardRejectedCache = [];
    let wargaScoreFilter = 'all'; // 'all' | 'pending' | 'confirmed'

    let customDateRange = null;

    const customBtn   = document.getElementById('customFilterBtn');
    const customPanel = document.getElementById('customRangePanel');
    const startInput = document.getElementById('startDateInput');
    const endInput   = document.getElementById('endDateInput');
    const applyBtn   = document.getElementById('applyCustomRangeBtn');
    const clearBtn   = document.getElementById('clearCustomRangeBtn');

    const chips = document.querySelectorAll('.chip');

    // ===== BLOK AUTO LOOKUP STATE =====
    let residentSuggestion = null;
    let multiDecisionMode = null; 
    // 'all' | 'single' | 'update'

    // ===== BLOK LOOKUP CONTROL =====
    let isLookupLocked = false;  // ⛔ stop auto lookup setelah decision

    // ===== AUTOFILL HELPERS =====
    function markAutofilled(el) {
      if (!el) return;
      el.dataset.autofilled = 'true';
      el.classList.add('autofilled');
    }

    function clearAutofilled(el) {
      if (!el) return;
      delete el.dataset.autofilled;
      el.classList.remove('autofilled');
    }

    // ===== UI CLEANUP HELPERS =====
    function removeUpdateSuggestionBtn() {
      const btn = document.getElementById('updateSuggestion');
      if (btn) btn.remove();
    }

    function buildUidHTML(item) {

    const bulanArray = (item.bulan || '')
      .toString()
      .split(',')
      .map(b => b.trim());

    let html = '';

    bulanArray.forEach((bulan, index) => {

      const uid = item.uidList[index] || '-';

      html += `
        <div class="flex justify-between items-center
              text-sm py-2 px-3 rounded-lg
              border-b border-gray-100 last:border-none">

          <span class="text-gray-500">
            ${bulan} ${item.tahun}
          </span>

          <span class="font-mono text-gray-900">
            ${uid}
          </span>

        </div>
      `;
    });

    return html;
  }

    // ===== IDENTITY RESET (WAJIB) =====
    function resetIdentityFields() {
      ['blok', 'nama', 'email', 'noHp'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.value = '';
        clearAutofilled(el);
      });

      // reset lookup state
      residentSuggestion = null;
      isLookupLocked = false;
      multiDecisionMode = null;

      // hide suggestion UI
      if (suggestionBox) suggestionBox.classList.add('hidden');
      removeUpdateSuggestionBtn();
      unlockIdentityFields();   // pastikan selalu editable saat reset
    }

    // ===== SEARCH ICON STATE =====
    function setBlokSearchLoading(isLoading) {
      const btn = document.getElementById('blokSearchBtn');
      const icon = document.getElementById('blokSearchIcon');
      if (!btn || !icon) return;

      btn.disabled = isLoading;

      if (isLoading) {
        icon.classList.add('searching', 'searching-pulse');
        btn.classList.add('text-blue-600');
      } else {
        icon.classList.remove('searching', 'searching-pulse');
        btn.classList.remove('text-blue-600');
      }
    }
    
    const nominalInput = document.getElementById('nominal');
    const manualCheckbox = document.getElementById('manualNominal');
    
    const noHpInput = document.getElementById('noHp');

    // ===== CLEAR AUTOFILL FLAG ON MANUAL INPUT =====
    ['nama', 'email', 'noHp'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      el.addEventListener('input', () => {
        updateSubmitButtonState();
      });
    });
    
    // ===== BLOK LOOKUP ELEMENT =====
    const blokInput = document.getElementById('blok');
    const suggestionBox = document.getElementById('blokSuggestion');

    if (suggestionBox) {
      suggestionBox.addEventListener('mousedown', function(e) {
        const chip = e.target.closest('.blok-chip');
        if (!chip) return;

        const val = blokInput.value;
        const parts = val.split(',');

        parts[parts.length - 1] = chip.innerText;

        blokInput.value = parts.join(', ').trim();

        suggestionBox.classList.add('hidden');

        triggerBlokLookup();
      });
    }
    const suggestionText = document.getElementById('blokSuggestionText');
    const blokLoading = document.getElementById('blokLookupLoading');

    // ===== BLOK LOOKUP – ICON SEARCH TRIGGER =====
    var blokBtn = document.getElementById('blokSearchBtn');
    if (blokBtn) {
      blokBtn.addEventListener('click', triggerBlokLookup);
    }

    function isValidBlokFormat(value) {
      if (!value) return false;

      const parts = value
        .split(',')
        .map(v => v.trim().toUpperCase())
        .filter(Boolean);

      // Format: 1 huruf + 1-3 angka
      const regex = /^[A-Z][0-9]{1,3}[A-Z]?$/;

      return parts.every(part => regex.test(part));
    }

    // ===== BLOK LOOKUP TRIGGER (CENTRAL FUNCTION) =====
    function triggerBlokLookup() {

      if (isLookupLocked) return;

      const val = blokInput.value.trim();

      // ===== EMPTY =====
      if (!val) {
        setBlokError('Nomor blok rumah wajib diisi');

        resetIdentityFields();
        lockIdentityFields();

        return;
      }

      // ===== INVALID FORMAT =====
      if (!isValidBlokFormat(val)) {

        setBlokError('Format blok tidak valid (contoh: B10)');

        resetIdentityFields();
        lockIdentityFields();

        return;
      }

      const inputBloks = val
        .split(',')
        .map(v => v.trim().toUpperCase())
        .filter(Boolean);

      const allValid = inputBloks.every(b =>
        VALID_BLOK_LIST.includes(b)
      );

      // ===== BLOK TIDAK ADA =====
      if (!allValid) {

        setBlokError('Nomor blok tidak ditemukan');

        resetIdentityFields();
        lockIdentityFields();

        return;
      }

      // ===== VALID =====
      clearBlokError();

      if (blokLoading) blokLoading.classList.remove('hidden');
      setBlokSearchLoading(true);

      residentSuggestion = null;
      if (suggestionBox) suggestionBox.classList.add('hidden');

      blokInput.classList.remove('border-red-500');

      var _snapshotBloks_ = val
        .split(',')
        .map(function(b){ return b.trim().toUpperCase(); })
        .filter(Boolean);

      var _lookupToken_ = val;

      gasGet_('getResidentByBlock', { blok: val })
        .then(function(res) {
          setBlokSearchLoading(false);
          if (blokLoading) blokLoading.classList.add('hidden');

          // Abaikan response jika input sudah berubah atau dikosongkan
          if (blokInput.value.trim() === '' || blokInput.value.trim().toUpperCase() !== _lookupToken_.toUpperCase()) {
            if (suggestionBox) suggestionBox.classList.add('hidden');
            return;
          }

          if (!res || !res.found) {
            residentSuggestion = null;
            if (suggestionBox) suggestionBox.classList.add('hidden');
            return;
          }
          handleResidentResult(res, _snapshotBloks_);
        })
        .catch(function() {
          setBlokSearchLoading(false);
          if (blokLoading) blokLoading.classList.add('hidden');
          showToast('Gagal mengambil data warga','error');
        });
    }

    function fillResidentData(res) {
      const nama = document.getElementById('nama');
      const email = document.getElementById('email');
      const noHp = document.getElementById('noHp');

      if (nama) {
        nama.value = res.nama || '';
        markAutofilled(nama);
      }

      if (email) {
        email.value = res.email || '';
        markAutofilled(email);
      }

      if (noHp) {
        noHp.value = res.noHp || '';
        markAutofilled(noHp);
      }
    }

    function lockIdentityFields() {
      ['nama', 'email', 'noHp'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.readOnly = true;
        el.classList.add('bg-gray-100', 'cursor-not-allowed');
      });
    }

    function unlockIdentityFields() {
      ['nama', 'email', 'noHp'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.readOnly = false;
        el.classList.remove('bg-gray-100', 'cursor-not-allowed');
      });
    }

    /* ================= MASKING HELPERS ================= */
    function maskName(name = '') {
      if (!name) return '-';

      return name
        .split(' ')
        .map(part => {
          if (part.length <= 2) return part[0] + '*';
          if (part.length <= 6) {
            // Tampilkan huruf pertama, mask tengah, tampilkan 1 terakhir
            return part[0] + '*'.repeat(part.length - 2) + part.slice(-1);
          }
          // Panjang > 6: tampilkan huruf pertama + 5 huruf terakhir
          return part[0] + '*'.repeat(part.length - 6) + part.slice(-5);
        })
        .join(' ');
    }

    function maskEmail(email = '') {
      if (!email || !email.includes('@')) return '-';

      const [local, domainFull] = email.split('@');
      const domainParts = domainFull.split('.');
      const mainDomain = domainParts[0];
      const ext = domainParts.slice(1).join('.');

      // ===== MASK LOCAL (USERNAME) =====
      let maskedLocal = '';

      const parts = local.split('.');

      maskedLocal = parts.map(part => {
        if (part.length <= 2) {
          return part[0] + '*';
        }
        if (part.length <= 4) {
          return part[0] + '*'.repeat(part.length - 2) + part.slice(-1);
        }
        // Tampilkan 1 pertama + 3 terakhir sebelum @
        return (
          part[0] +
          '*'.repeat(part.length - 4) +
          part.slice(-3)
        );
      }).join('.');

      // ===== MASK DOMAIN =====
      const commonProviders = [
        'gmail',
        'yahoo',
        'outlook',
        'icloud',
        'hotmail'
      ];

      let maskedDomain = mainDomain;

      if (!commonProviders.includes(mainDomain.toLowerCase())) {
        maskedDomain =
          mainDomain[0] +
          '*'.repeat(mainDomain.length - 2) +
          mainDomain.slice(-1);
      }

      return `${maskedLocal}@${maskedDomain}${ext ? '.' + ext : ''}`;
    }

    function maskPhone(phone = '') {
      if (!phone) return '-';

      const clean = String(phone).replace(/\s/g, '');
      if (clean.length <= 6) return clean;

      // Tampilkan 4 depan + 3 belakang, tengah di-mask
      return (
        clean.slice(0, 4) +
        '*'.repeat(Math.max(2, clean.length - 7)) +
        clean.slice(-3)
      );
    }

    function handleResidentResult(res, snapshotBloks) {

      residentSuggestion = res;

      const card = suggestionBox;
      const text = suggestionText;

      const inputBloks = snapshotBloks || blokInput.value
        .split(',')
        .map(b => b.trim().toUpperCase())
        .filter(Boolean);

      const related = res.relatedBlocks || [];

      const hasValidEmail =
        res.email && res.email.trim().length > 0;

      const isMultiDetected =
        hasValidEmail &&
        related.length > 1 &&
        inputBloks.length === 1;

      // =========================
      // MULTI BLOK DETECTED
      // =========================
      if (isMultiDetected) {

        text.innerHTML = `
          💡 Kami mendeteksi Anda memiliki beberapa rumah.<br><br>

          <b>Daftar blok:</b><br>
          ${related.map(b => `• ${b}`).join('<br>')}
          <br><br>

          Nama: <b>${maskName(res.nama)}</b><br>
          Email: <b>${maskEmail(res.email)}</b><br>
          No HP: <b>${maskPhone(res.noHp)}</b>

          <div class="mt-3">
            <button id="useResidentData"
              class="w-full bg-primary text-white text-sm py-2 rounded-lg font-medium">
              Ya gunakan untuk semua
            </button>
          </div>
        `;

        const current = inputBloks[0];
        const others = related.filter(b => b !== current);

        blokInput.value = [current, ...others].join(', ');

      } else {

        const blokList = related.length
          ? related.join(', ')
          : res.blok;

        text.innerHTML = `
          💡 Data warga ditemukan.<br><br>

          Blok: <b>${blokList}</b><br>
          Nama: <b>${maskName(res.nama)}</b><br>
          Email: <b>${maskEmail(res.email)}</b><br>
          No HP: <b>${maskPhone(res.noHp)}</b>

          <div class="mt-3">
            <button id="useResidentData"
              class="w-full bg-primary text-white text-sm py-2 rounded-lg font-medium">
              Ya gunakan data ini
            </button>
          </div>
        `;
      }

      // =========================
      // UI
      // =========================

      card.classList.remove('hidden');
      card.classList.remove('animate-fadeIn');
      void card.offsetWidth;
      card.classList.add('animate-fadeIn');

      setTimeout(() => {

        const useBtn = document.getElementById('useResidentData');

        if (useBtn) {
          useBtn.onclick = () => {

            useBtn.disabled = true;

            const namaEl = document.getElementById('nama');
            const emailEl = document.getElementById('email');
            const hpEl = document.getElementById('noHp');

            if (namaEl) {
              namaEl.dataset.fullValue = res.nama || '';
              namaEl.value = maskName(res.nama);
              markAutofilled(namaEl);
            }

            if (emailEl) {
              emailEl.dataset.fullValue = res.email || '';
              emailEl.value = maskEmail(res.email);
              markAutofilled(emailEl);
            }

            if (hpEl) {
              hpEl.dataset.fullValue = res.noHp || '';
              hpEl.value = maskPhone(res.noHp);
              markAutofilled(hpEl);
            }

            lockIdentityFields();

            isLookupLocked = true;

            suggestionBox.classList.add('hidden');

            showToast('Data warga digunakan','success');

            // Auto-load paid months berdasarkan email dari lookup result
            // (cover: admin bantu warga, dan warga tidak login)
            // SELALU fetch fresh per blok — jangan pakai cache dari blok sebelumnya
            var lookupEmail = res.email || '';
            if (lookupEmail) {
              // Reset cache dulu agar data blok lama tidak carry-over
              wargaPaidMonths    = null;
              wargaPendingMonths = null;
              wargaRateByMonth   = null;
              userOverrideRateByYear = {};
              selectedMonthsByYear = {};

              showDetailPaymentSkeleton_(true);
              gasGet_('getWargaPaidMonths', { email: lookupEmail })
                .then(function(pmRes) {
                  showDetailPaymentSkeleton_(false);
                  if (!pmRes || !pmRes.ok) return;
                  wargaPaidMonths  = pmRes.paid;
                  wargaRateByMonth = pmRes.rateByMonth || null;
                  applyPaidMonthsData_(pmRes);
                })
                .catch(function() {
                  showDetailPaymentSkeleton_(false);
                });
            } else {
              updateNominalAuto();
            }
          };
        }

      },0);
    }

    if (noHpInput) {
      noHpInput.addEventListener('input', () => {
        let val = noHpInput.value;

        // 1️⃣ Hapus semua selain angka dan +
        val = val.replace(/[^\d+]/g, '');

        // 2️⃣ Jika mulai dengan 0 → ganti jadi +62
        if (val.startsWith('0')) {
          val = '+62' + val.slice(1);
        }

        // 3️⃣ Jika mulai dengan 62 tanpa + → tambahkan +
        if (val.startsWith('62')) {
          val = '+' + val;
        }

        // 4️⃣ Cegah + lebih dari satu
        if ((val.match(/\+/g) || []).length > 1) {
          val = '+' + val.replace(/\+/g, '');
        }

        noHpInput.value = val;
      });
    }

    // ===== BLOK AUTO LOOKUP (TRIGGER CENTRAL) =====
    if (blokInput) {

      blokInput.addEventListener('input', () => {
        clearBlokError();
        blokInput.value = blokInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9,]/g, '');

        isLookupLocked = false;
        multiDecisionMode = null;

        const val = blokInput.value.trim();

        if (!val) {
          blokInput.classList.remove('border-red-500');
          suggestionBox.classList.add('hidden');
          residentSuggestion = null;
          isLookupLocked = false;
          suggestionText.innerHTML = '';
          return;
        }

        // 🔥 ambil blok terakhir untuk suggestion
        const parts = val.split(',');
        const lastPart = parts[parts.length - 1].trim();

        const suggestions = getBlokSuggestions(lastPart);

        if(suggestions.length === 1){

          // Jika lastPart sudah exact match → jangan replace seluruh value
          if(lastPart.toUpperCase() === suggestions[0].toUpperCase()){
            suggestionBox.classList.add('hidden');
            triggerBlokLookup();
            return;
          }

          // Belum exact → replace lastPart saja, bukan seluruh value
          parts[parts.length - 1] = suggestions[0];
          blokInput.value = parts.join(', ').trim();

          suggestionBox.classList.add('hidden');

          triggerBlokLookup();

          return;

        }
        
        if (suggestions.length) {

          blokInput.classList.remove('border-red-500');

          suggestionText.innerHTML =
            suggestions.map((b,i) =>
              `<span class="blok-chip" data-index="${i}">${b}</span>`
            ).join(' ');

          suggestionBox.classList.remove('hidden');

          // animasi muncul
          suggestionBox.classList.remove('animate-suggest');
          void suggestionBox.offsetWidth;
          suggestionBox.classList.add('animate-suggest');

        } else {

          blokInput.classList.add('border-red-500');
          suggestionBox.classList.add('hidden');

          clearTimeout(blokToastTimeout);
          blokToastTimeout = setTimeout(() => {
            showToast('Nomor blok tidak ditemukan','error');
          }, 500);
        }

      });

      // 🔹 trigger saat pindah field
      // blokInput.addEventListener('blur', triggerBlokLookup);

      // 🔹 trigger saat tekan ENTER
      blokInput.addEventListener('keydown', e => {
        const chips = document.querySelectorAll('.blok-chip');
        if(e.key === 'ArrowDown'){
          e.preventDefault();
          blokSuggestionIndex++;
          if(blokSuggestionIndex >= chips.length){
            blokSuggestionIndex = 0;
          }
          highlightBlokSuggestion(blokSuggestionIndex);
        }

        if(e.key === 'ArrowUp'){
          e.preventDefault();
          blokSuggestionIndex--;
          if(blokSuggestionIndex < 0){
            blokSuggestionIndex = chips.length-1;
          }
          highlightBlokSuggestion(blokSuggestionIndex);
        }

        if(e.key === 'Enter'){
          if(blokSuggestionIndex >=0){
            e.preventDefault();
            const val = currentSuggestions[blokSuggestionIndex];
            blokInput.value = val;
            suggestionBox.classList.add('hidden');
            triggerBlokLookup();
          }
        }
      });
    }

    const hunianRadios = document.querySelectorAll('input[name="hunian"]');

    let bulanCount = 0;
    let rate = 0;

    // ===== UTIL =====
    function setTodayDate() {
      const tanggalInput = document.getElementById('tanggal');
      if (!tanggalInput) return;

      const today = new Date();
      tanggalInput.value = formatDateISO(today);
      tanggalInput.dispatchEvent(new Event('change'));
      _updateTanggalUI_();
    }

    function onTanggalChange() {
      _updateTanggalUI_();
    }

    function _updateTanggalUI_() {
      const tanggalInput  = document.getElementById('tanggal');
      const container     = document.getElementById('tanggalContainer');
      const badge         = document.getElementById('tanggalTodayBadge');
      const display       = document.getElementById('tanggalDisplay');
      const helperText    = document.getElementById('tanggalHelperText');
      if (!tanggalInput) return;

      const val     = tanggalInput.value;
      const today   = formatDateISO(new Date());
      const isToday = val === today;
      const hasVal  = !!val;

      // Format display: "31 May 2026"
      if (display) {
        if (hasVal) {
          const [y, m, d] = val.split('-');
          const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
          display.innerText = d + ' ' + (months[parseInt(m,10)-1] || m) + ' ' + y;
          display.classList.remove('text-gray-400');
          display.classList.add('text-gray-800');
        } else {
          display.innerText = 'Pilih tanggal';
          display.classList.remove('text-gray-800');
          display.classList.add('text-gray-400');
        }
      }

      // Container border & bg
      if (hasVal) {
        container.classList.remove('bg-gray-50', 'border-gray-200');
        container.classList.add('bg-white', 'border-primary/40');
      } else {
        container.classList.remove('bg-white', 'border-primary/40');
        container.classList.add('bg-gray-50', 'border-gray-200');
      }

      // Badge "✓ Hari ini"
      if (badge) {
        if (isToday) {
          badge.classList.remove('hidden');
          badge.classList.add('flex');
        } else {
          badge.classList.add('hidden');
          badge.classList.remove('flex');
        }
      }

      // Helper text
      if (helperText) {
        if (isToday) {
          helperText.innerText = 'Tanggal hari ini sudah diisi otomatis. Ubah jika transfer dilakukan sebelumnya.';
          helperText.classList.remove('text-gray-400');
          helperText.classList.add('text-primary/70');
        } else if (hasVal) {
          helperText.innerText = 'Pastikan tanggal sesuai bukti transfer Anda.';
          helperText.classList.remove('text-primary/70');
          helperText.classList.add('text-gray-400');
        } else {
          helperText.innerText = 'Isi sesuai tanggal transfer di bukti pembayaran Anda.';
          helperText.classList.remove('text-primary/70');
          helperText.classList.add('text-gray-400');
        }
      }

      updateSubmitButtonState();
    }

    function formatRupiah(value) {
      const number = value.replace(/[^\d]/g, '');
      if (!number) return 'Rp 0';
      return 'Rp ' + Number(number).toLocaleString('id-ID');
    }

    function getNumber(value) {
      return Number(value.replace(/[^\d]/g, '')) || 0;
    }

    function formatDateISO(date) {
      // Pakai tanggal LOKAL (bukan toISOString yg UTC → bisa mundur 1 hari di WIB)
      var y = date.getFullYear();
      var m = String(date.getMonth() + 1).padStart(2, '0');
      var d = String(date.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    function formatDateHuman(date) {
      return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    }

    function getHouseCount() {
      const val = blokInput.value || '';
      return val
        .split(',')
        .map(b => b.trim())
        .filter(Boolean)
        .length || 1;
    }

    function updateChipStates_() {
      if (!selectedYear) return;

      var now = new Date();
      var currentYear  = now.getFullYear();
      var currentMonth = now.getMonth();
      var currentDay   = now.getDate();

      var yr      = parseInt(selectedYear, 10);
      var paid    = (wargaPaidMonths    && wargaPaidMonths[yr])    ? wargaPaidMonths[yr]    : [];
      var pending = (wargaPendingMonths && wargaPendingMonths[yr]) ? wargaPendingMonths[yr] : [];

      // Hanya tampilkan selected state untuk tahun yang sedang aktif (selectedYear)
      var selectedInThisYear = selectedMonthsByYear[selectedYear] || [];

      var monthChips = document.querySelectorAll('#bulanChips .chip');
      monthChips.forEach(function(chip, idx) {

        // Reset semua state dulu
        chip.classList.remove('active');
        chip.disabled = false;
        chip.style.background  = '';
        chip.style.color       = '';
        chip.style.borderColor = '';
        chip.style.opacity     = '';
        chip.style.cursor      = '';
        chip.style.boxShadow   = '';
        chip.removeAttribute('data-pending-label');

        // Sudah bayar di tahun ini → grey, tidak bisa dipilih
        if (paid.includes(idx)) {
          chip.disabled = true;
          chip.style.background  = '#f3f4f6';
          chip.style.color       = '#9ca3af';
          chip.style.borderColor = '#e5e7eb';
          chip.style.cursor      = 'not-allowed';
          chip.style.opacity     = '0.6';
          return;
        }

        // Masih Pending (menunggu konfirmasi admin) → orange, tidak bisa dipilih
        if (pending.includes(idx)) {
          chip.disabled = false; // jangan disabled agar click bisa ditangkap
          chip.style.background  = '#fffbeb';
          chip.style.color       = '#d97706';
          chip.style.borderColor = '#fcd34d';
          chip.style.cursor      = 'not-allowed';
          chip.style.opacity     = '0.85';
          chip.setAttribute('data-pending', '1');
          return;
        }
        chip.removeAttribute('data-pending');

        // Cek overdue untuk tahun yang sedang ditampilkan
        var isOverdue = false;
        if (yr < currentYear) {
          isOverdue = true;
        } else if (yr === currentYear) {
          // jatuh tempo = tgl 5 bulan berikutnya
          var dueMonth = idx + 1; // 0-based bulan berikutnya
          if (dueMonth < currentMonth) {
            isOverdue = true;
          } else if (dueMonth === currentMonth && currentDay > 5) {
            isOverdue = true;
          }
        }

        // Tampilkan warna overdue (belum bayar, belum dipilih)
        if (isOverdue) {
          chip.style.background  = '#fff1f2';
          chip.style.color       = '#e11d48';
          chip.style.borderColor = '#fda4af';
        }

        // Tampilkan selected state HANYA untuk selectedYear aktif
        if (selectedInThisYear.includes(idx)) {
          chip.classList.add('active');
          if (isOverdue) {
            chip.style.background  = '#be123c';
            chip.style.color       = '#ffffff';
            chip.style.borderColor = '#9f1239';
            chip.style.boxShadow   = '0 0 0 2px #fda4af';
          }
        }
      });

      // Chip tahun — grey jika semua 12 bulan lunas
      document.querySelectorAll('.chip-year').forEach(function(btn) {
        var y = parseInt(btn.textContent.trim(), 10);
        var p = (wargaPaidMonths && wargaPaidMonths[y]) ? wargaPaidMonths[y] : [];
        if (p.length >= 12) {
          btn.disabled = true;
          btn.style.opacity = '0.4';
          btn.style.cursor  = 'not-allowed';
        } else {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.cursor  = '';
        }
      });
    }

    // ===== AUTO CALC =====
    function updateNominalAuto() {
      if (manualCheckbox.checked) return;

      // WAJIB: hunian & bulan harus ada
      if (!selectedRate || !bulanCount) {
        nominalInput.value = 'Rp 0';
        return;
      }

      const houseCount = getHouseCount();
      const total = selectedRate * houseCount * bulanCount;

      nominalInput.value = formatRupiah(String(total));
    }

    function updateNominalBreakdown_() {
      var nominalEl   = document.getElementById('nominal');
      var breakdownEl = document.getElementById('nominalBreakdown');
      if (!nominalEl) return;

      if (manualCheckbox && manualCheckbox.checked) return;

      if (!selectedRate || selectedRate <= 0) {
        nominalEl.value = 'Rp 0';
        if (breakdownEl) breakdownEl.innerHTML = '';
        return;
      }

      var houseCount   = 1; // rate sudah di-merge per blok di backend
      var grandTotal   = 0;
      var breakdownHtml = '';
      var monthNames   = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

      var years = Object.keys(selectedMonthsByYear).sort();

      years.forEach(function(yr) {
        var months = selectedMonthsByYear[yr] || [];
        if (!months.length) return;

        var yrInt = parseInt(yr, 10);
        // Jika user override untuk tahun ini → pakai override, ignore wargaRateByMonth
        var overrideForYear = userOverrideRateByYear[yr] || null;
        var rateMap = (!overrideForYear && wargaRateByMonth && wargaRateByMonth[yrInt])
          ? wargaRateByMonth[yrInt]
          : null;

        // Group bulan berdasarkan rate-nya
        var rateGroups = {}; // { '200000': [0,1,2], '175000': [2,3] }

        months.forEach(function(mIdx) {
          var rate = 0;

          if (overrideForYear) {
            // User sudah manual pilih hunian — pakai override
            rate = overrideForYear;
          } else if (rateMap) {
            // Cek rateByMonth per bulan spesifik (dari helper AK-AP di sheet)
            var key = yrInt + '_' + mIdx;
            if (rateMap[key] && rateMap[key] > 0) {
              rate = rateMap[key];
            }
          }

          // Fallback: kolom E via selectedRate
          if (!rate) rate = selectedRate;
          if (!rateGroups[rate]) rateGroups[rate] = [];
          rateGroups[rate].push(mIdx);
        });

        // Render breakdown per rate group per tahun
        Object.keys(rateGroups).forEach(function(rate) {
          var rateNum  = Number(rate);
          var mIdxs    = rateGroups[rate];
          var subtotal = rateNum * houseCount * mIdxs.length;
          grandTotal  += subtotal;

          var labels = mIdxs.map(function(i){ return monthNames[i]; }).join(', ');

          // Tampilkan breakdown per blok jika multi-blok
          var bloksArr = (wargaRateByMonth && window._wargaBloks_) ? window._wargaBloks_ : null;
          if (bloksArr && bloksArr.length > 1) {
            // Render per blok
            bloksArr.forEach(function(blokName) {
              // Ambil rate blok ini dari rateByBlokMonth[blokName][yr]
              var blokRate = rateNum / bloksArr.length; // fallback equal split
              if (window._rateByBlokMonth_ && window._rateByBlokMonth_[blokName]) {
                var brmYear = window._rateByBlokMonth_[blokName][yrInt] || window._rateByBlokMonth_[blokName];
                var key0 = yrInt + '_' + mIdxs[0];
                if (brmYear && brmYear[key0]) blokRate = brmYear[key0];
              }
              var blokSubtotal = blokRate * mIdxs.length;
              breakdownHtml +=
                '<div class="flex justify-between text-xs text-gray-500 mt-1">' +
                  '<span>' + labels + ' ' + yr + ' (' + blokName + ')</span>' +
                  '<span>Rp ' + Number(blokSubtotal).toLocaleString('id-ID') + '</span>' +
                '</div>';
            });
          } else {
            breakdownHtml +=
              '<div class="flex justify-between text-xs text-gray-500 mt-1">' +
                '<span>' + labels + ' ' + yr + '</span>' +
                '<span>Rp ' + Number(subtotal).toLocaleString('id-ID') + '</span>' +
              '</div>';
          }
        });
      });

      nominalEl.value = grandTotal > 0
        ? 'Rp ' + Number(grandTotal).toLocaleString('id-ID')
        : 'Rp 0';

      if (breakdownEl) breakdownEl.innerHTML = breakdownHtml;
    }

    function applyPaidMonthsData_(res) {
      if (!res || !res.ok) return;

      wargaPaidMonths    = res.paid;
      wargaPendingMonths = res.pending || null;
      wargaRateByMonth   = res.rateByMonth || null;
      window._wargaBloks_ = res.bloks || null;
      window._rateByBlokMonth_ = res.rateByBlokMonth || null;

      // === 1) Set rate & hunian card ===
      // Priority 1: defaultRate dari server (sudah hitung AK-AP + fallback E)
      var rateToApply = (res.defaultRate && res.defaultRate > 0) ? res.defaultRate : 0;

      // Priority 2 (hanya jika server tidak kirim defaultRate): cari dari rateByMonth
      // Cari bulan pertama yang belum bayar di tahun berjalan
      if (!rateToApply && wargaRateByMonth) {
        var nowYr2  = new Date().getFullYear();
        var nowMon2 = new Date().getMonth();
        var paidNow2 = (wargaPaidMonths && wargaPaidMonths[nowYr2]) ? wargaPaidMonths[nowYr2] : [];
        var rMap2 = wargaRateByMonth[nowYr2] || {};
        // Cari dari bulan yg belum bayar mulai bulan ini
        for (var mi2b = nowMon2; mi2b < 12; mi2b++) {
          if (!paidNow2.includes(mi2b)) {
            var rk2 = nowYr2 + '_' + mi2b;
            if (rMap2[rk2] && rMap2[rk2] > 0) {
              rateToApply = rMap2[rk2];
              break;
            }
          }
        }
        // Cari bulan sebelumnya (overdue) jika belum ketemu
        if (!rateToApply) {
          for (var mi2c = 0; mi2c < nowMon2; mi2c++) {
            if (!paidNow2.includes(mi2c)) {
              var rk2c = nowYr2 + '_' + mi2c;
              if (rMap2[rk2c] && rMap2[rk2c] > 0) {
                rateToApply = rMap2[rk2c];
                break;
              }
            }
          }
        }
      }

      if (rateToApply > 0) {
        selectedRate = rateToApply;
        rate = selectedRate;

        // Cek apakah semua blok punya rate sama — baca dari res langsung
        var bloksArr2 = (res.bloks && res.bloks.length) ? res.bloks : [];
        var rateByBlokMap2 = res.rateByBlokMonth || null;
        var yr2 = new Date().getFullYear();
        var nowM2 = new Date().getMonth();

        var allRates2 = bloksArr2.map(function(b) {
          if (rateByBlokMap2 && rateByBlokMap2[b] && rateByBlokMap2[b][yr2]) {
            return rateByBlokMap2[b][yr2][yr2 + '_' + nowM2] || 0;
          }
          return 0;
        }).filter(function(r) { return r > 0; });

        var allSameRate = bloksArr2.length <= 1 ||
          allRates2.length === 0 ||
          allRates2.every(function(r) { return r === allRates2[0]; });

        // Per-house rate: selectedRate might be total when multi-house
        var _blokCount2 = Math.max(bloksArr2.length, 1);
        var _perHouseRate2 = allRates2.length > 0
          ? allRates2[0]
          : Math.round(selectedRate / _blokCount2);

        document.querySelectorAll('.hunian-card').forEach(function(card) {
          card.classList.remove('active');
          if (!allSameRate) {
            // Rate berbeda antar blok — disable card, tampilkan tooltip
            card.disabled = true;
            card.style.opacity = '0.4';
            card.style.cursor = 'not-allowed';
            card.title = 'Tarif IPL berbeda antar rumah — tidak dapat diubah manual';
          } else {
            // Rate sama — enable normal, select matching card
            card.disabled = false;
            card.style.opacity = '';
            card.style.cursor = '';
            card.title = '';
            var cardVal = Number(card.dataset.value);
            // Match against per-house rate (primary) OR selectedRate directly (single house)
            if (cardVal === _perHouseRate2 || cardVal === selectedRate) {
              card.classList.add('active');
            }
          }
        });
      }

      // === 2) Set tahun chip ===
      var currentYearStr = String(new Date().getFullYear());
      selectedYear = currentYearStr;
      document.querySelectorAll('.chip-year').forEach(function(btn) {
        btn.classList.remove('active');
        if (btn.textContent.trim() === currentYearStr) {
          btn.classList.add('active');
        }
      });

      // Init selectedMonthsByYear untuk tahun ini jika belum ada
      if (!selectedMonthsByYear[selectedYear]) {
        selectedMonthsByYear[selectedYear] = [];
      }

      // === 2.5) Hapus bulan pending & paid dari selectedMonthsByYear ===
      // Agar auto-suggest tidak pre-select bulan yg sudah disubmit / sudah lunas
      Object.keys(selectedMonthsByYear).forEach(function(yr) {
        var yrN = parseInt(yr, 10);
        var paidY    = (wargaPaidMonths    && wargaPaidMonths[yrN])    ? wargaPaidMonths[yrN]    : [];
        var pendingY = (wargaPendingMonths && wargaPendingMonths[yrN]) ? wargaPendingMonths[yrN] : [];
        selectedMonthsByYear[yr] = selectedMonthsByYear[yr].filter(function(m) {
          return !paidY.includes(m) && !pendingY.includes(m);
        });
      });

      // === 3) Update chip states (paid=grey, pending=orange, overdue=merah) ===
      updateChipStates_();

      // === 4) Auto-suggest bulan pertama yang belum bayar ===
      var autoYear = selectedYear;
      var yrInt    = parseInt(autoYear, 10);
      var paidInYear = (wargaPaidMonths && wargaPaidMonths[yrInt]) ? wargaPaidMonths[yrInt] : [];

      var now3        = new Date();
      var currentYear3 = now3.getFullYear();
      var currentMonth3 = now3.getMonth(); // 0-based (Mar = 2)

      // Untuk tahun berjalan: suggest s.d. bulan depan (inklusif)
      // agar upcoming bulan berikutnya setelah terakhir bayar ter-suggest
      var maxSuggestMonth = (yrInt === currentYear3) ? Math.min(currentMonth3 + 1, 11) : 11;

      var pendingInYear = (wargaPendingMonths && wargaPendingMonths[yrInt]) ? wargaPendingMonths[yrInt] : [];

      var firstUnpaid = -1;
      // Loop dari bulan 0 untuk catch tunggakan lama
      // Loop sampai maxSuggestMonth+1 untuk catch upcoming
      for (var mi3 = 0; mi3 <= maxSuggestMonth; mi3++) {
        if (!paidInYear.includes(mi3) && !pendingInYear.includes(mi3)) {
          firstUnpaid = mi3;
          break;
        }
      }
      // Jika semua bulan 0..maxSuggestMonth sudah bayar/pending,
      // suggest bulan berikutnya (upcoming) jika masih dalam tahun berjalan
      if (firstUnpaid === -1 && yrInt === currentYear3 && maxSuggestMonth < 11) {
        var nextMonth = maxSuggestMonth + 1;
        if (!paidInYear.includes(nextMonth) && !pendingInYear.includes(nextMonth)) {
          firstUnpaid = nextMonth;
        }
      }

      if (firstUnpaid >= 0) {
        if (!selectedMonthsByYear[autoYear].includes(firstUnpaid)) {
          selectedMonthsByYear[autoYear].push(firstUnpaid);
          selectedMonthsByYear[autoYear].sort(function(a,b){return a-b;});
        }

        bulanCount = Object.values(selectedMonthsByYear)
          .reduce(function(s, arr){ return s + arr.length; }, 0);

        // Re-render chip + nominal + submit button
        updateChipStates_();
        updateNominalBreakdown_();
        updateSubmitButtonState();
      } else {
        // Semua bulan sudah bayar — update breakdown saja
        updateNominalBreakdown_();
        updateSubmitButtonState();
      }
    }

    // ===== BULAN CHIP =====
    chips.forEach(function(chip, idx) {
      chip.addEventListener('click', function() {
        if (chip.disabled) return;

        // Chip pending — tampilkan hint, jangan proses
        if (chip.getAttribute('data-pending') === '1') {
          var ex = document.getElementById('pendingChipBubble');
          if (ex) return;
          var b = document.createElement('div');
          b.id = 'pendingChipBubble';
          b.style.cssText = [
            'position:fixed','bottom:100px','left:50%',
            'transform:translateX(-50%)',
            'background:#1f2937','color:#fff',
            'font-size:13px','font-weight:500',
            'padding:10px 18px','border-radius:12px',
            'white-space:nowrap','z-index:99999',
            'opacity:0','transition:opacity 0.2s ease',
            'pointer-events:none'
          ].join(';');
          b.innerText = 'Menunggu verifikasi pengurus';
          document.body.appendChild(b);
          requestAnimationFrame(function(){ b.style.opacity = '1'; });
          setTimeout(function(){
            b.style.opacity = '0';
            setTimeout(function(){ if (b.parentNode) b.parentNode.removeChild(b); }, 200);
          }, 2500);
          return;
        }

        if (!selectedYear) {
          showToast('Pilih tahun terlebih dahulu', 'error');
          return;
        }

        chip.classList.toggle('active');

        // sync ke selectedMonthsByYear
        if (!selectedMonthsByYear[selectedYear]) {
          selectedMonthsByYear[selectedYear] = [];
        }

        if (chip.classList.contains('active')) {
          if (!selectedMonthsByYear[selectedYear].includes(idx)) {
            selectedMonthsByYear[selectedYear].push(idx);
            selectedMonthsByYear[selectedYear].sort(function(a,b){return a-b;});
          }
        } else {
          selectedMonthsByYear[selectedYear] =
            selectedMonthsByYear[selectedYear].filter(function(i){ return i !== idx; });
        }

        bulanCount = Object.values(selectedMonthsByYear)
          .reduce(function(s,arr){ return s + arr.length; }, 0);

        updateChipStates_();
        updateNominalBreakdown_();
        _syncHunianCardToSelectedMonths_();
        updateSubmitButtonState();
      });
    });

    // ===== STATUS HUNIAN =====
    hunianRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        rate = Number(radio.value);
        updateNominalAuto();
      });
    });

    // ===== TAHUN DIBAYAR (SINGLE SELECT) =====
    document.querySelectorAll('.chip-year').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.disabled) return;

        // toggle active — boleh multi-tahun
        btn.classList.toggle('active');

        var yr = btn.textContent.trim();

        if (btn.classList.contains('active')) {
          selectedYear = yr;
          if (!selectedMonthsByYear[yr]) {
            selectedMonthsByYear[yr] = [];
          }

          // Set default rate untuk tahun ini
          // Prioritas: userOverride → wargaRateByMonth bulan pertama belum bayar → selectedRate
          if (!userOverrideRateByYear[yr]) {
            var yrInt = parseInt(yr, 10);
            var paidInYr = (wargaPaidMonths && wargaPaidMonths[yrInt]) ? wargaPaidMonths[yrInt] : [];
            var rMap = (wargaRateByMonth && wargaRateByMonth[yrInt]) ? wargaRateByMonth[yrInt] : null;
            var defaultRateForYr = selectedRate;

            if (rMap) {
              for (var m = 0; m < 12; m++) {
                if (!paidInYr.includes(m)) {
                  var key = yrInt + '_' + m;
                  if (rMap[key] && rMap[key] > 0) {
                    defaultRateForYr = rMap[key];
                    break;
                  }
                }
              }
            }

            selectedRate = defaultRateForYr;
            rate = selectedRate;

            // Update hunian card UI
            var _bc3 = (window._wargaBloks_ && window._wargaBloks_.length > 1) ? window._wargaBloks_.length : 1;
            var _perHouse3 = Math.round(selectedRate / _bc3);
            document.querySelectorAll('.hunian-card').forEach(function(card) {
              card.classList.remove('active');
              var _cv3 = Number(card.dataset.value);
              if (_cv3 === _perHouse3 || _cv3 === selectedRate) {
                card.classList.add('active');
              }
            });
          }
        } else {
          // deselect tahun → hapus bulan di tahun itu
          delete selectedMonthsByYear[yr];
          // set selectedYear ke tahun aktif lainnya
          var activeYears = Array.from(
            document.querySelectorAll('.chip-year.active')
          ).map(function(b){ return b.textContent.trim(); });
          selectedYear = activeYears.length ? activeYears[activeYears.length - 1] : null;
        }

        // sync chip bulan ke selectedYear terakhir
        updateChipStates_();
        updateNominalBreakdown_();
        updateSubmitButtonState();
      });
    });

    // ===== STATUS HUNIAN (CARD BUTTON) — delegation, kartu di-render dinamis =====
    var _hunianBox = document.getElementById('hunianCards');
    if (_hunianBox) {
      _hunianBox.addEventListener('click', function (e) {
        var card = e.target.closest('.hunian-card');
        if (!card || card.disabled || !_hunianBox.contains(card)) return;

        _hunianBox.querySelectorAll('.hunian-card').forEach(function (c) { c.classList.remove('active'); });
        card.classList.add('active');

        selectedRate = Number(card.dataset.value) || 0;
        rate = selectedRate;
        if (selectedYear) {
          userOverrideRateByYear[selectedYear] = selectedRate;
        }
        updateNominalBreakdown_();
        updateSubmitButtonState();
      });
    }

    // ===== MANUAL TOGGLE =====
    manualCheckbox.addEventListener('change', () => {
      if (manualCheckbox.checked) {
        nominalInput.readOnly = false;
        nominalInput.classList.remove('bg-gray-100');
        nominalInput.classList.add('bg-white');
        nominalInput.value = '';
        nominalInput.focus();
      } else {
        nominalInput.readOnly = true;
        nominalInput.classList.add('bg-gray-100');
        nominalInput.classList.remove('bg-white');
        updateNominalAuto();
      }
      updateSubmitButtonState();
    });

    // ===== FORMAT MANUAL INPUT =====
    nominalInput.addEventListener('input', () => {
      if (!manualCheckbox.checked) return;
      nominalInput.value = formatRupiah(nominalInput.value);
      updateSubmitButtonState();
    });

    // ===== SHEET CONTROL =====
    function openSheet() {
      console.log('OPEN SHEET USER:', currentUser);
      setActiveNavById('navFabBayarBtn');
      // ===== PUSH HISTORY STATE (ANDROID BACK SUPPORT) =====
      if (!history.state || !history.state.sheet) {
        history.pushState({ sheet: true }, '');
      }
      resetIdentityFields();
      resetUploadSection();
      document.body.classList.add('ipl-form-open');

      // 🔥 RESET lookup & decision state (WAJIB)
      isLookupLocked = false;
      multiDecisionMode = null;
      residentSuggestion = null;

      // For admin: show picker FIRST, sheet revealed after selection
      if (currentUser && currentUser.role === 'admin') {
        const identitySection2 = document.getElementById('identitySection');
        if (identitySection2) identitySection2.classList.remove('hidden');
        openAdminBayarPicker();
        return;
      }

      const sheet = document.getElementById('sheet');
      const overlay = document.getElementById('overlay');

      sheet.scrollTop = 0;
      sheet.classList.remove('translate-y-[120%]');
      overlay.classList.remove('hidden');
      document.body.style.overflow = 'hidden';

      /* ================= RESET STATE ================= */
      selectedYear = null;
      selectedRate = 0;
      bulanCount = 0;
      selectedMonthsByYear = {};

      /* ================= RESET UI ================= */

      // reset tahun
      document.querySelectorAll('.chip-year.active')
        .forEach(b => b.classList.remove('active'));

      // reset hunian
      document.querySelectorAll('.hunian-card.active')
        .forEach(c => c.classList.remove('active'));

      // reset bulan
      document.querySelectorAll('.chip.active')
        .forEach(c => c.classList.remove('active'));

      // reset nominal
      if (nominalInput) {
        nominalInput.value = 'Rp 0';
      }

      /* ================= TANGGAL ================= */
      const tanggalInput = document.getElementById('tanggal');
      if (tanggalInput) {
        if (!tanggalInput.value) tanggalInput.value = formatDateISO(new Date());
        _updateTanggalUI_();
      }

      /* ================= FOCUS (TERAKHIR) ================= */
      /* setTimeout(() => {
        if (tanggalInput) {
          tanggalInput.focus();
          tanggalInput.click();
        }
      }, 300); */
      
      /* ================= LOGIN MODE HANDLING ================= */
      const identitySection = document.getElementById('identitySection');

      // (admin handled earlier — picker shown first)

      if (currentUser && currentUser.role !== 'admin') {
        // Warga biasa → auto-fill & hide identity
        if (!Array.isArray(currentUser.wargaData) || !currentUser.wargaData.length) {
          gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
            .then(function(dataRes) {
              if (dataRes && dataRes.success) {
                currentUser.wargaData = dataRes.data || [];
              }
              openSheet();
            });
          return;
        }

        fillIdentityFromWargaData_();
        if (identitySection) identitySection.classList.add('hidden');
        // TIDAK return — lanjut ke load paid months
      }

      // Tidak login (hanya jika currentUser null)
      if (!currentUser) {
        if (identitySection) identitySection.classList.remove('hidden');
      }

      // Load paid months jika login — gunakan cache jika sudah ada
      if (currentUser && currentUser.email) {
        if (wargaPaidMonths && wargaRateByMonth) {
          // Cache hit — langsung apply tanpa fetch
          applyPaidMonthsData_({
            ok: true,
            paid: wargaPaidMonths,
            pending: wargaPendingMonths || {},
            rateByMonth: wargaRateByMonth,
            defaultRate: currentUser._cachedDefaultRate || 0,
            bloks: window._wargaBloks_ || [],
            rateByBlokMonth: window._rateByBlokMonth_ || null
          });
        } else {
          showDetailPaymentSkeleton_(true);
          gasGet_('getWargaPaidMonths', { email: currentUser.email })
            .then(function(res) {
              showDetailPaymentSkeleton_(false);
              console.log('[paidMonths] response:', JSON.stringify(res));
              if (!res || !res.ok) return;
              wargaPaidMonths = res.paid;
              wargaRateByMonth = res.rateByMonth || null;
              if (currentUser) currentUser._cachedDefaultRate = res.defaultRate || 0;
              applyPaidMonthsData_(res);
            })
            .catch(function() {
              showDetailPaymentSkeleton_(false);
            });
        }
      }
    }

    function closeSheet() {
      resetIdentityFields();
      
      // JANGAN null-kan wargaPaidMonths — cache tetap hidup untuk open berikutnya
      userOverrideRateByYear = {};
      selectedMonthsByYear = {};
      userOverrideRateByYear = {};
      
      var summaryCard = document.getElementById('identitySummaryCard');
      if (summaryCard) summaryCard.classList.add('hidden');
      
      document.body.classList.remove('ipl-form-open');
      const sheet = document.getElementById('sheet');
      const overlay = document.getElementById('overlay');
      sheet.classList.remove('translate-y-[120%]');
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
      if (typeof _ghostShield_ === 'function') _ghostShield_();
    }

    const uploadInput = document.getElementById('buktiUpload');
    if (uploadInput) {
      uploadInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        startUploadProgress(file);
      });
    }

    const uploadText = document.getElementById('uploadText');
    const previewContainer = document.getElementById('previewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const pdfPreview = document.getElementById('pdfPreview');
    const pdfName = document.getElementById('pdfName');

    function setActiveNav(el) {
      document.querySelectorAll('.nav-app')
        .forEach(n => n.classList.remove('active'));
      el.classList.add('active');
    }

    function comingSoon() {
      document.getElementById('comingSoon').classList.remove('hidden');
    }

    function closeComingSoon() {
      document.getElementById('comingSoon').classList.add('hidden');
    }

    function disableSubmit() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      btn.disabled = true;
      btn.innerHTML = `
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"
              stroke="white" stroke-width="3"
              fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"
              stroke="white" stroke-width="3"
              fill="none"/>
          </svg>
          Submitting...
        </span>
      `;
    }

    function enableSubmit() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      btn.disabled = false;
      btn.innerHTML = 'Kirim Konfirmasi Pembayaran';
    }

    function successIcon() {
      return `
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M5 13l4 4L19 7" />
        </svg>
      `;
    }

    function errorIcon() {
      return `
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
    }

    /* ================= SUBMIT FORM ================= */
    function submitForm() {
      disableSubmit();

      const namaEl = document.getElementById('nama');
      const emailEl = document.getElementById('email');
      const hpEl = document.getElementById('noHp');

      const payload = {
        nama: (namaEl && namaEl.dataset.fullValue) || (namaEl && namaEl.value) || '',
        blokRumah: (document.getElementById('blok') && document.getElementById('blok').value) || '',
        email: (emailEl && emailEl.dataset.fullValue) || (emailEl && emailEl.value) || '',
        noHp: (hpEl && hpEl.dataset.fullValue) || (hpEl && hpEl.value) || '',

        statusTinggal: (function() {
          var activeCard = document.querySelector('.hunian-card.active');
          if (activeCard) return activeCard.dataset.label || (Number(activeCard.dataset.value) >= 190000 ? 'Rumah Dihuni' : 'Rumah Tidak Dihuni');
          // Fallback: derive per-house rate from selectedRate / blok count
          var _bc = (window._wargaBloks_ && window._wargaBloks_.length > 1) ? window._wargaBloks_.length : 1;
          return Math.round(selectedRate / _bc) >= 190000 ? 'Rumah Dihuni' : 'Rumah Tidak Dihuni';
        })(),

        rate: selectedRate,
        tahun: Object.keys(selectedMonthsByYear).sort()[0] || selectedYear,
        bulan: Object.values(selectedMonthsByYear).reduce(function(a,b){ return a.concat(b); }, [])
          .map(function(i){
            return ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][i];
          }),

        // Multi-tahun payload
        bulanPerTahun: (function() {
          var result = {};
          var monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
          Object.keys(selectedMonthsByYear).forEach(function(yr) {
            result[yr] = (selectedMonthsByYear[yr] || []).map(function(i){ return monthNames[i]; });
          });
          return result;
        })(),

        nominalPerTahun: (function() {
          var result = {};
          var houseCount = 1; // rate sudah di-merge per blok di backend
          Object.keys(selectedMonthsByYear).forEach(function(yr) {
            var yrInt  = parseInt(yr, 10);
            var months = selectedMonthsByYear[yr] || [];
            var overrideForYear = userOverrideRateByYear[yr] || null;
            var rateMap = (!overrideForYear && wargaRateByMonth && wargaRateByMonth[yrInt])
              ? wargaRateByMonth[yrInt]
              : null;
            var total  = 0;
            months.forEach(function(mIdx) {
              var rate = overrideForYear || selectedRate;
              if (rateMap) {
                var key = yrInt + '_' + mIdx;
                if (rateMap[key] && rateMap[key] > 0) rate = rateMap[key];
              }
              total += rate * houseCount;
            });
            result[yr] = total;
          });
          return result;
        })(),

        nominal: Number(
          ((document.getElementById('nominal') && document.getElementById('nominal').value) || '').replace(/[^\d]/g, '')
        ),

        bank: (document.getElementById('bank') && document.getElementById('bank').value) || '',
        rekening: (document.getElementById('rekening') && document.getElementById('rekening').value) || '',
        keterangan: (document.getElementById('keterangan') && document.getElementById('keterangan').value) || '',
        buktiUrl: uploadedFile || '',

        multiRumah: ((document.getElementById('blok') && document.getElementById('blok').value) || '').includes(','),

        manualOverride: {
          nama: !(namaEl && namaEl.dataset.autofilled),
          email: !(emailEl && emailEl.dataset.autofilled),
          noHp: !(hpEl && hpEl.dataset.autofilled)
        },

        tanggalBayar: (document.getElementById('tanggal') && document.getElementById('tanggal').value) || '',
      };

      // ===== FORCE SESSION DATA UNTUK WARGA =====
      if (currentUser && currentUser.role === 'warga' && currentUser.wargaData) {

        const first = currentUser.wargaData[0];

        payload.nama = first.nama || payload.nama;
        payload.email = first.email || currentUser.email;
        payload.noHp = first.noHp || payload.noHp;

        payload.blokRumah = currentUser.wargaData
          .map(d => d.blok)
          .join(', ');
      }

      gasPost_('submitIPLForm', { payload: payload })
        .then(function(res) {
          enableSubmit();
          if (res && res.success === false) {
            if (res.duplicate) {
              showToast(res.message || 'Kamu sudah punya submission yang masih Pending untuk bulan ini.', 'error');
            } else {
              showToast(res.message || 'Gagal menyimpan data, silakan coba lagi.', 'error');
            }
            return;
          }
          var _bulanNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
          var _periodeStr = (payload.bulanPerTahun
            ? Object.entries(payload.bulanPerTahun)
                .map(function(e){ return e[1].join(', ') + ' ' + e[0]; })
                .join(' | ')
            : (payload.bulan || []).map(function(b){ return _bulanNames[b] || b; }).join(', ') + ' ' + (payload.tahun || '')
          ).trim();
          var _nominalStr = 'Rp ' + Number(payload.nominal || 0).toLocaleString('id-ID');
          showPaymentSuccessBanner({
            nama   : payload.nama,
            blok   : payload.blokRumah,
            periode: _periodeStr,
            nominal: _nominalStr
          });
          resetForm();
          setTimeout(function() {
            closeSheet();
            openHome();
          }, 600);
        })
        .catch(function(err) {
          console.error('Submit error:', err);
          showToast('Gagal menyimpan data, silakan coba lagi.','error');
          enableSubmit();
        });
    }

    /* ================= RESET ================= */
    function resetUploadSection() {

      // reset state variable
      uploadedFile = null;

      // revoke object URL jika ada
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      }

      // hide preview container
      const preview = document.getElementById('previewContainer');
      if (preview) preview.classList.add('hidden');

      // reset image
      const img = document.getElementById('imagePreview');
      if (img) {
        img.src = '';
        img.classList.add('hidden');
      }

      // reset pdf
      const pdf = document.getElementById('pdfPreview');
      if (pdf) pdf.classList.add('hidden');

      const pdfName = document.getElementById('pdfName');
      if (pdfName) pdfName.textContent = '';

      // reset file input
      const fileInput = document.getElementById('buktiUpload');
      if (fileInput) fileInput.value = '';

      // reset progress bar
      const bar = document.getElementById('uploadBar');
      if (bar) bar.style.width = '0%';

      const percent = document.getElementById('uploadPercent');
      if (percent) percent.innerText = '0%';
    }
    
    function resetForm() {
      /* ================= RESET INPUT ================= */
      document.querySelectorAll('input, textarea').forEach(el => {
        if (el.type === 'radio' || el.type === 'checkbox') {
          el.checked = false;
        } else {
          el.value = '';
        }
      });

      /* ================= RESET CHIP BULAN ================= */
      document.querySelectorAll('.chip.active')
        .forEach(c => c.classList.remove('active'));

      /* ================= RESET CHIP TAHUN ================= */
      document.querySelectorAll('.chip-year.active')
        .forEach(c => c.classList.remove('active'));

      /* ================= RESET HUNIAN ================= */
      document.querySelectorAll('.hunian-card.active')
        .forEach(c => c.classList.remove('active'));

      /* ================= RESET STATE ================= */
      selectedYear = null;
      selectedRate = 0;
      bulanCount = 0;

      /* ================= RESET NOMINAL ================= */
      const nominalEl = document.getElementById('nominal');
      if (nominalEl) nominalEl.value = 'Rp 0';

      /* ================= RESET UPLOAD ================= */
      resetUploadSection();

      /* ================= RESET BUTTON ================= */
      updateSubmitButtonState();
    }

    function checkFormValiditySilent() {

      // input text required
      const blokVal = document.getElementById('blok')?.value || '';
      if(!isValidBlokFormat(blokVal)) return false;
      const inputBloks = blokVal
      .split(',')
      .map(b=>b.trim().toUpperCase())
      .filter(Boolean);

      const allValid = inputBloks.every(b =>
      VALID_BLOK_LIST.includes(b)
      );
      if(!allValid) return false;

      const requiredInputs = document.querySelectorAll(
        'input[data-required="true"], textarea[data-required="true"]'
      );

      for (const el of requiredInputs) {
        if (!el.value || !el.value.trim()) return false;
      }

      // bulan + tahun (multi-tahun)
      var totalSelected = Object.values(selectedMonthsByYear)
        .reduce(function(s,arr){ return s + arr.length; }, 0);
      if (totalSelected === 0) return false;
      if (!Object.keys(selectedMonthsByYear).length) return false;

      // hunian
      if (!selectedRate || selectedRate <= 0) return false;

      // nominal
      const nominalEl = document.getElementById('nominal');
      const nominalVal = (nominalEl && nominalEl.value) || '';
      if (!nominalVal || nominalVal === 'Rp 0') return false;

      // upload
      if (!uploadedFile) return false;

      return true;
    }

    function updateSubmitButtonState() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      const isValid = checkFormValiditySilent();

      btn.disabled = !isValid;
    }

    function validateForm() {
      /* ========= RESET ERROR STATE ========= */
      document.querySelectorAll('.field-error')
        .forEach(el => el.classList.remove('field-error'));

      let firstError = null;
      let isValid = true;

      /* ========= RESET STATE VISUAL ========= */
      document
        .querySelectorAll('.border-red-500')
        .forEach(el => el.classList.remove('border-red-500'));

      /* ========= INPUT WAJIB ========= */
      const inputRequired = document.querySelectorAll(
        'input[data-required="true"], textarea[data-required="true"]'
      );

      inputRequired.forEach(el => {
        if (!el.value || !el.value.trim()) {
          isValid = false;
          el.classList.add('border-red-500');
          if (!firstError) firstError = el;
        }
      });

      /* ========= BULAN ========= */
      if (document.querySelectorAll('.chip.active').length === 0) {
        isValid = false;
        const bulanEl = document.getElementById('bulanChips');
        if (bulanEl) bulanEl.classList.add('field-error');
        if (!firstError) firstError = bulanEl;
      }

      /* ========= TAHUN ========= */
      if (!selectedYear) {
        isValid = false;
        const tahunEl = document.getElementById('tahunChips');
        if (tahunEl) tahunEl.classList.add('field-error');
        if (!firstError) firstError = tahunEl;
      }

      /* ========= STATUS HUNIAN ========= */
      if (!selectedRate || selectedRate <= 0) {
        isValid = false;
        const hunianEl = document.getElementById('hunianCards');
        if (hunianEl) hunianEl.classList.add('field-error');
        if (!firstError) firstError = hunianEl;
      }

      /* ========= NOMINAL (HANYA JIKA MANUAL) ========= */
      const manualCheckbox = document.getElementById('manualNominal');
      const nominalEl = document.getElementById('nominal');

      if (manualCheckbox && manualCheckbox.checked) {
        const value = (nominalEl && nominalEl.value || '').replace(/[^\d]/g, '') || '0';

        if (Number(value) <= 0) {
          isValid = false;
          nominalEl.classList.add('border-red-500');
          if (!firstError) firstError = nominalEl;
        }
      }

      /* ========= UPLOAD ========= */
      if (!uploadedFile) {
        isValid = false;
        const uploadEl = document.querySelector('label[for="buktiUpload"]');
        if (uploadEl) uploadEl.classList.add('field-error');
        if (!firstError) firstError = uploadEl;
      }

      /* ========= SCROLL + SHAKE ========= */
      if (!isValid && firstError) {

        // trigger shake
        firstError.classList.add('shake');

        // remove shake agar bisa dipicu ulang
        setTimeout(() => {
          firstError.classList.remove('shake');
        }, 400);

        // scroll ke error
        firstError.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      return isValid;
    }

    function startUploadProgress(file) {

      // VALIDASI UKURAN FILE (WAJIB DI PALING ATAS)
      if (file.size > 5 * 1024 * 1024) {
        showToast('Ukuran file maksimal 5MB','error');
        return;
      }
      
      const progressWrap = document.getElementById('uploadProgress');
      const bar = document.getElementById('uploadBar');
      const percent = document.getElementById('uploadPercent');
      const uploadText = document.getElementById('uploadText');

      uploadText.classList.add('hidden');
      progressWrap.classList.remove('hidden');

      let progress = 0;
      let finished = false;

      const interval = setInterval(() => {
        if (finished) return;

        progress += Math.random() * 10;
        if (progress >= 90) progress = 90;

        bar.style.width = progress + '%';

        // UX hint saat proses server-side
        if (progress >= 85) {
          percent.innerText = 'Menyimpan...';
        } else {
          percent.innerText = Math.floor(progress) + '%';
        }
      }, 300);

      // ⛑️ FAIL-SAFE: auto stop after 60s
      const safetyTimeout = setTimeout(() => {
        if (!finished) {
          clearInterval(interval);
          showToast('Upload memakan waktu terlalu lama, silakan coba ulang.','error');
          progressWrap.classList.add('hidden');
          uploadText.classList.remove('hidden');
        }
      }, 60000);

      const reader = new FileReader();

      reader.onload = e => {
        const base64 = e.target.result.split(',')[1];

        const meta = {
          blok: (document.getElementById('blok') && document.getElementById('blok').value) || '',
          periode: Array.from(document.querySelectorAll('.chip.active'))
            .map(c => c.textContent)
            .join('-'),
          nama: (document.getElementById('nama') && document.getElementById('nama').value) || ''
        };

        gasPost_('uploadBuktiTransfer', {
            base64: base64,
            filename: file.name,
            mimeType: file.type,
            meta: meta
          })
            .then(function(res) {
              finished = true;
              clearInterval(interval);
              clearTimeout(safetyTimeout);
              bar.style.width = '100%';
              percent.innerText = '100%';
              setTimeout(function() {
                progressWrap.classList.add('hidden');
                uploadText.classList.remove('hidden');
                showPreview(file, res.url);
                uploadedFile = res.url;
                updateSubmitButtonState();
              }, 400);
            })
            .catch(function() {
              finished = true;
              clearInterval(interval);
              clearTimeout(safetyTimeout);
              showToast('Upload gagal, silakan coba lagi.','error');
              progressWrap.classList.add('hidden');
              uploadText.classList.remove('hidden');
            });
      };

      reader.readAsDataURL(file);
    }

    function showPreview(file, url) {
      const container = document.getElementById('previewContainer');
      const img = document.getElementById('imagePreview');
      const pdf = document.getElementById('pdfPreview');
      const pdfName = document.getElementById('pdfName');

      container.classList.remove('hidden');

      if (file.type.startsWith('image/')) {
        // 🔥 revoke URL lama jika ada
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
        }
        previewObjectUrl = URL.createObjectURL(file);
        img.src = previewObjectUrl;
        img.classList.remove('hidden');
        pdf.classList.add('hidden');
      } else {
        pdfName.innerText = file.name;
        pdf.classList.remove('hidden');
        img.classList.add('hidden');
      }
    }

    function removeUploadedFile() {
      uploadedFile = null;
      updateSubmitButtonState();

      document.getElementById('previewContainer').classList.add('hidden');
      document.getElementById('uploadBar').style.width = '0%';
      document.getElementById('uploadPercent').innerText = '0%';

      document.getElementById('buktiUpload').value = '';
    }

    function onSubmitClick() {
      if (!validateForm()) return;
      openConfirm();
    }

    function openConfirm() {
      const modal = document.getElementById('confirmModal');
      const text = modal.querySelector('p');

      text.innerText = 'Apakah data pembayaran ini sudah benar?';

      modal.classList.remove('hidden');
    }

    function closeConfirm() {
      document.getElementById('confirmModal').classList.add('hidden');
    }

    function confirmSubmit() {
      closeConfirm();

      // beri 1 frame agar DOM bersih
      requestAnimationFrame(() => {
        submitForm();
      });
    }

    /* ================= SUCCESS TOAST (DASHBOARD) ================= */
    function showToast(message, type = 'success') {

      const toast = document.getElementById('toast');
      const toastInner = document.getElementById('toastInner');

      if (!toast || !toastInner) return;

      const isError   = type === 'error';
      const isWarning = type === 'warning';

      const bg        = isError ? 'bg-red-100'    : isWarning ? 'bg-yellow-100' : 'bg-blue-100';
      const iconColor = isError ? 'text-red-600'  : isWarning ? 'text-yellow-600' : 'text-blue-600';

      const icon = isError
        ? `<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>`
        : isWarning
        ? `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>`
        : `<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>`;

      toastInner.innerHTML = `
        <div class="w-8 h-8 rounded-full ${bg} flex items-center justify-center">
          <svg class="w-4 h-4 ${iconColor}"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24">
            ${icon}
          </svg>
        </div>

        <div class="flex-1 text-sm font-medium text-gray-800 text-center">
          ${message || ''}
        </div>
      `;

      toast.classList.remove('hidden');
      toast.style.opacity = '1';
      toastInner.classList.remove('opacity-0', 'translate-y-3');
      toastInner.style.opacity = '1';
      toastInner.style.transform = 'translateY(0)';

      if (activeToastTimer) {
        clearTimeout(activeToastTimer);
      }

      activeToastTimer = setTimeout(() => {

        toastInner.style.opacity = '0';
        toastInner.style.transform = 'translateY(12px)';
        toastInner.classList.add('opacity-0', 'translate-y-3');

        setTimeout(() => {
          toast.classList.add('hidden');
          toast.style.opacity = '';
          toastInner.innerHTML = '';
          toastInner.style.opacity = '';
          toastInner.style.transform = '';
        }, 250);

      }, 2200);
    }

    function showSuccessToast(message){
      showToast(message,'success');
    }

    function showErrorToast(message){
      showToast(message,'error');
    }

    function copyToClipboard(text) {

      if (!text || text === '-') return;

      navigator.clipboard.writeText(text)
        .then(() => {
          showToast('ID Pembayaran disalin','success');
        })
        .catch(() => {
          showToast('Gagal menyalin ID','error');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
      updateHeaderAuthUI();
      loadHomeData();
      /* ===============================
        CLOSE SHEET WHEN IPL MENU CLICKED
        =============================== */
      const activeNav = document.querySelector('.nav-active');
      if (activeNav) {
        activeNav.addEventListener('click', () => {
          closeSheet();
        });
      }

      /* ===============================
        PAYMENT SUCCESS BANNER
        Click outside to close
        =============================== */
      const banner = document.getElementById('paymentSuccessBanner');
      if (banner) {
        banner.addEventListener('click', e => {
          // klik hanya area overlay hitam, BUKAN card putih
          if (e.target === banner) {
            closePaymentBanner();
          }
        });
      }

      /* ===============================
        DATE INITIALIZATION (DEFAULT TODAY)
        =============================== */
      const tanggalInput = document.getElementById('tanggal');
      const useToday = document.getElementById('useTodayDate');
      const todayLabel = document.getElementById('todayDateLabel');

      const today = new Date();
      const todayISO = formatDateISO(today);

      // Default tanggal = hari ini
      if (tanggalInput) {
        tanggalInput.value = todayISO;
        _updateTanggalUI_();
      }

      // Label human-readable
      if (todayLabel) {
        todayLabel.textContent = `(${formatDateHuman(today)})`;
      }

      // Toggle "gunakan hari ini"
      if (useToday && tanggalInput) {
        useToday.addEventListener('change', () => {
          if (useToday.checked) {
            tanggalInput.value = todayISO;
          } else {
            tanggalInput.value = '';
            tanggalInput.focus();
          }
        });
      }

      /* ===============================
        SEARCH LISTENER
        =============================== */
      var searchEl = document.getElementById('dashboardSearch');
        if (searchEl) {
          searchEl.addEventListener('input', function () {
            applyFilters();
          });
        }

      // ===== FILTER DATE =====
      document.querySelectorAll('.filter-date-chip').forEach(btn => {
        btn.addEventListener('click', function() {
          const filter = this.dataset.filter || this.innerText.toLowerCase();
          if (filter !== 'custom') {
            document.querySelectorAll('.filter-date-chip')
              .forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            activeTimeFilter = filter;
            customDateRange = null;
            customPanel.classList.add('hidden');
            applyFilters();
          }
        });

      });

      // ===== FILTER BULAN =====
      var monthFilterEl = document.getElementById('monthFilterSelect');
      if (monthFilterEl) {
        monthFilterEl.addEventListener('change', function() {
          applyFilters();
        });
      }

      // ===== FILTER CATEGORY =====
      document.querySelectorAll('.filter-category').forEach(btn => {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.filter-category')
            .forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          activeRateFilter =
            this.innerText.includes('200') ? 200000 : 175000;
          applyFilters();
        });
      });

      const startInput  = document.getElementById('startDateInput');
      const endInput    = document.getElementById('endDateInput');
      const applyBtn    = document.getElementById('applyCustomRangeBtn');
      const clearBtn    = document.getElementById('clearCustomRangeBtn');
      const customBtn   = document.getElementById('customFilterBtn');
      const customPanel = document.getElementById('customRangePanel');

      /* ===== TOGGLE PANEL ===== */
      customBtn?.addEventListener('click', function(e) {
        e.preventDefault();

        const isHidden = customPanel.classList.contains('hidden');

        document.querySelectorAll('.filter-date-chip')
          .forEach(c => c.classList.remove('active'));

        this.classList.add('active');

        customPanel.classList.toggle('hidden', !isHidden);
      });

      /* ===== APPLY ===== */
      applyBtn?.addEventListener('click', function() {

        if (!startInput.value || !endInput.value) {
          alert('Pilih start dan end date');
          return;
        }

        customDateRange = {
          start: startInput.value,
          end: endInput.value
        };

        // 🔥 reset predefined time filter
        activeTimeFilter = 'all';

        customPanel.classList.add('hidden');
        applyFilters();
      });

      /* ===== CLEAR ===== */
      clearBtn?.addEventListener('click', function() {

        startInput.value = '';
        endInput.value   = '';
        customDateRange  = null;
        activeTimeFilter = 'all';

        customPanel.classList.add('hidden');
        applyFilters();
      });

      /* ===============================
        LOGIN REQUIRED → GO TO PAGE SAYA
        =============================== */
      const loginRequiredBtn = document.getElementById('loginRequiredBtn');

      if (loginRequiredBtn) {
        loginRequiredBtn.addEventListener('click', () => {
          closeLoginRequiredModal();
          closeSheet();        // 🔥 tutup sheet dulu
          openPageSaya();      // 🔥 baru buka Saya
        });
      }

      /* ===============================
        READ ONLY NAMA WARGA, EMAIL DAN NP HP
        =============================== */
      const nama = document.getElementById('nama');
      const email = document.getElementById('email');
      const hp = document.getElementById('noHp');

      [nama,email,hp].forEach(el=>{
        if(!el) return;
        el.readOnly = true;
        el.classList.add('bg-gray-100','cursor-not-allowed');
      });

      const updateBtn = document.getElementById('updateDataRedirectBtn');
      if (updateBtn) {
        updateBtn.addEventListener('click', () => {

          if (!currentUser) {
            openLoginRequiredModal('Silakan login untuk memperbarui data Anda.');
            return;
          }

          openPageSaya();
        });
      }
      const namaField = document.getElementById('nama');
      const emailField = document.getElementById('email');
      const hpField = document.getElementById('noHp');

      if (namaField) namaField.readOnly = true;
      if (emailField) emailField.readOnly = true;
      if (hpField) hpField.readOnly = true;
    });

  // View mode dashboard: 'self' (riwayat pribadi) vs admin (verifikasi)
  var _dashAdminView_ = false;
  function _dashIsAdmin_() { return _dashAdminView_ && currentUser && currentUser.role === 'admin'; }

  // History menu → selalu tampil pembayaran pribadi (warga view)
  function openHistory() { _dashAdminView_ = false; openDashboard(); }
  // Admin menu → tab Verifikasi (semua pembayaran warga + Confirm/Reject)
  // Buka admin → tab Verifikasi (dipakai bila perlu dari luar)
  function openAdminVerifikasi() {
    if (!(currentUser && currentUser.role === 'admin')) return;
    if (typeof openAdminPage === 'function') openAdminPage();
    if (typeof switchAdminTab === 'function') switchAdminTab('verifikasi');
  }

  function _resetDashFilters_() {
    activeTimeFilter = 'all';
    activeRateFilter = null;
    customDateRange = null;
    wargaScoreFilter = 'all';
    _wargaScorecardBound_ = false;
  }

  // Pindahkan konten dashboard ke host tertentu (#dashboard untuk History,
  // atau panel Verifikasi untuk admin). inline=true → tampil mengalir.
  function _mountDashboard_(target, inline) {
    var inner = document.getElementById('dashboardInner');
    if (!inner || !target) return;
    if (inner.parentElement !== target) target.appendChild(inner);
    inner.classList.toggle('dash-inline', !!inline);
  }

  // Setup UI + load data (dipakai oleh History page maupun tab Verifikasi)
  function _setupDashboardView_() {
    var loadingEl = document.getElementById('dashboardLoading');
    var errorEl   = document.getElementById('dashboardError');
    if (errorEl) errorEl.classList.add('hidden');

    var isAdmin = _dashIsAdmin_();
    var titleEl   = document.getElementById('dashboardTitle');
    var tabRow    = document.getElementById('dashboardTabRow');
    var filterRow = document.getElementById('dashboardFilterRow');

    if (titleEl) titleEl.innerText = isAdmin ? 'Dashboard Verifikasi' : 'Riwayat Pembayaran';
    var subEl = document.getElementById('dashboardSubtitle');
    if (subEl) {
      if (isAdmin) {
        subEl.innerText = 'Semua daftar pembayaran warga';
      } else {
        var _nm = (currentUser && currentUser.fullName) ? currentUser.fullName.split(' ')[0] : '';
        subEl.innerText = _nm ? ('Riwayat pembayaran IPL ' + _nm) : 'Riwayat pembayaran IPL kamu';
      }
    }
    if (tabRow)    tabRow.classList.add('hidden');
    if (filterRow) filterRow.classList.toggle('hidden', !isAdmin);

    // Warga: tampilkan semua riwayat; Admin: pakai tab admin (pending/confirmed)
    if (!isAdmin) activeTabType = 'all_warga';
    else if (activeTabType === 'all_warga') activeTabType = 'pending';

    if (dashboardCache) {
      if (loadingEl) loadingEl.classList.add('hidden');
      hydrateDashboardFromCache();
      return;
    }

    try {
      var _ss = sessionStorage.getItem('dashCache');
      if (_ss) {
        var _parsed = JSON.parse(_ss);
        if (_parsed && (Date.now() - (_parsed._ts || 0)) < 3 * 60 * 1000) {
          dashboardCache = _parsed;
          dashboardPendingCache   = _parsed.pending   || [];
          dashboardConfirmedCache = _parsed.confirmed || [];
          dashboardRejectedCache  = _parsed.rejected  || [];
          if (loadingEl) loadingEl.classList.add('hidden');
          hydrateDashboardFromCache();
          return;
        }
      }
    } catch(e) {}

    if (loadingEl) loadingEl.classList.remove('hidden');
    loadDashboardWithRetry(0);
  }

  // HISTORY page — riwayat pribadi (self view)
  function openDashboard() {
    if (!currentUser) {
      openLoginRequiredModal();
      return;
    }

    switchPage('dashboard');
    _resetDashFilters_();

    if (!history.state || !history.state.dashboard) {
      history.pushState({ dashboard: true }, '');
    }

    var dashboardEl = document.getElementById('dashboard');
    _mountDashboard_(dashboardEl, false);   // kembalikan konten ke halaman History
    dashboardEl.classList.remove('hidden');

    var dashScroll = document.querySelector('#dashboard .flex-1.overflow-y-auto');
    if (dashScroll) dashScroll.scrollTop = 0;

    setActiveNavById('navActivity');
    _setupDashboardView_();
  }

  // ADMIN tab "Verifikasi" — tampil inline di panel admin (admin view)
  function _renderVerifikasiInline_() {
    if (!(currentUser && currentUser.role === 'admin')) return;
    _dashAdminView_ = true;
    activeTabType   = 'pending';
    _resetDashFilters_();
    var panel = document.querySelector('#adminPanels > [data-panel="verifikasi"]');
    _mountDashboard_(panel, true);
    _setupDashboardView_();
  }

  function loadDashboardWithRetry(attempt) {
    var MAX_RETRY = 2;
    var loadingEl = document.getElementById('dashboardLoading');
    var errorEl   = document.getElementById('dashboardError');

    if (loadingEl) { loadingEl.style.display = 'flex'; }
    if (errorEl)   errorEl.classList.add('hidden');

    gasGet_('getDashboardDataOptimized')
      .then(function(response) {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (!response) {
          if (attempt < MAX_RETRY) {
            setTimeout(function() { loadDashboardWithRetry(attempt + 1); }, 1200);
            return;
          }
          if (errorEl) errorEl.classList.remove('hidden');
          return;
        }
        if (response._debug) console.warn('[Dashboard] GAS debug:', response._debug);
        if (response.error) console.error('[Dashboard] GAS error:', response.error);
        dashboardCache = response;
        dashboardPendingCache   = response.pending   || [];
        dashboardConfirmedCache = response.confirmed || [];
        dashboardRejectedCache  = response.rejected  || [];
        // Save to sessionStorage with timestamp
        try { response._ts = Date.now(); sessionStorage.setItem('dashCache', JSON.stringify(response)); } catch(e) {}
        hydrateDashboardFromCache();
      })
      .catch(function() {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (attempt < MAX_RETRY) {
          setTimeout(function() { loadDashboardWithRetry(attempt + 1); }, 1200);
          return;
        }
        if (errorEl) errorEl.classList.remove('hidden');
      });
  }

  function openLoginRequiredModal(customText) {
    const modal = document.getElementById('loginRequiredModal');
    const card = document.getElementById('loginRequiredCard');
    const btn = document.getElementById('loginRequiredBtn');
    const textEl = document.getElementById('loginRequiredText');

    if (!modal || !card) return;

    if (textEl) textEl.innerText = customText || 'Silakan login untuk mengakses History.';

    modal.classList.remove('hidden');

    requestAnimationFrame(() => {
      card.classList.remove('opacity-0', 'scale-95');
      card.classList.add('opacity-100', 'scale-100');
    });

    btn.onclick = function () {
      closeLoginRequiredModal();
      openPageSaya();
    };
  }

  function closeLoginRequiredModal() {
    const modal = document.getElementById('loginRequiredModal');
    const card = document.getElementById('loginRequiredCard');

    if (!modal || !card) return;

    card.classList.remove('opacity-100', 'scale-100');
    card.classList.add('opacity-0', 'scale-95');

    setTimeout(() => {
      modal.classList.add('hidden');
    }, 180);
  }

  function refreshDashboard() {
    const dashboardEl = document.getElementById('dashboard');
    const loadingEl = document.getElementById('dashboardLoading');
    const errorEl = document.getElementById('dashboardError');
    const listEl = document.getElementById('dashboardList');

    // 🔥 RESET FRONTEND CACHE
    dashboardCache = null;
    dashboardPendingCache = [];
    dashboardConfirmedCache = [];
    dashboardRejectedCache = [];
    try { sessionStorage.removeItem('dashCache'); } catch(e) {}

    // 🔥 CLEAR UI DULU (BIAR TIDAK TERLIHAT STALE)
    if (listEl) listEl.innerHTML = '';
    if (errorEl) errorEl.classList.add('hidden');
    if (loadingEl) { loadingEl.style.display = 'flex'; }

    // 🔥 CALL FRESH DATA (SERVER CLEAR CACHE)
    gasGet_('getDashboardDataFresh')
      .then(function(response) {
        if (!response) {
          loadingEl.classList.add('hidden');
          errorEl.classList.remove('hidden');
          return;
        }
        dashboardCache = response;
        dashboardPendingCache = response.pending || [];
        dashboardConfirmedCache = response.confirmed || [];
        loadingEl.classList.add('hidden');
        hydrateDashboardFromCache();
        showToast('Data berhasil diperbarui','success');
      })
      .catch(function(err) {
        console.error(err);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
        showToast('Gagal memuat data terbaru','error');
      });
  }

  function updateDashboardTimestamp() {
    const el = document.getElementById('dashboardLastUpdated');
    if (!el) return;

    const now = new Date();

    const time = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    el.style.opacity = '0';

    setTimeout(() => {
      el.innerText = `Updated ${time}`;
      el.style.opacity = '1';
    }, 120);
  }

  function hydrateDashboardFromCache() {
    const loadingEl = document.getElementById('dashboardLoading');
    if (loadingEl) {
      loadingEl.classList.add('hidden');
    }
    // pastikan tab aktif konsisten
    activeTabType = activeTabType || 'pending';
    // set underline active UI saja
    document.querySelectorAll('.tab-underline')
      .forEach(btn => btn.classList.remove('active'));
    if (activeTabType === 'pending') {
      document.getElementById('tabPending')?.classList.add('active');
    } else {
      document.getElementById('tabConfirmed')?.classList.add('active');
    }
    // 🔥 WAJIB: hitung ulang count + render sesuai filter & role
    applyFilters();
    updateDashboardTimestamp();
    updateDashboardScorecards();
    if (_dashIsAdmin_()) _updateScorecardActive_(activeTabType);
  }

  function updateDashboardScorecards() {
    var isAdmin = _dashIsAdmin_();
    var sc = document.getElementById('dashboardScorecards');
    if (!sc) return;
    sc.classList.remove('hidden');

    var el = function(id) { return document.getElementById(id); };
    // Compact format: 1.200.000 → 1,2 Jt, 43.825.000 → 43,8 Jt
    function fmt(n) {
      n = Number(n);
      if (n >= 1000000) return 'Rp ' + (n / 1000000).toFixed(1).replace('.', ',') + ' Jt';
      if (n >= 1000)    return 'Rp ' + Math.round(n / 1000) + ' Rb';
      return 'Rp ' + n.toLocaleString('id-ID');
    }

    if (isAdmin) {
      var pending   = dashboardPendingCache   || [];
      var confirmed = dashboardConfirmedCache || [];
      var pendingAmt   = pending.reduce(function(s, i)   { return s + Number(i.nominal || 0); }, 0);
      var confirmedAmt = confirmed.reduce(function(s, i) { return s + Number(i.nominal || 0); }, 0);

      if (el('scPendingLabel'))    el('scPendingLabel').textContent   = 'Pending';
      if (el('scPendingCount'))    el('scPendingCount').textContent   = pending.length;
      if (el('scPendingAmount'))   el('scPendingAmount').textContent  = fmt(pendingAmt);
      if (el('scConfirmedLabel'))  el('scConfirmedLabel').textContent = 'Confirmed';
      if (el('scConfirmedCount'))  el('scConfirmedCount').textContent = confirmed.length;
      if (el('scConfirmedAmount')) el('scConfirmedAmount').textContent = fmt(confirmedAmt);
      if (el('scTotalAmount'))     el('scTotalAmount').textContent    = fmt(confirmedAmt);
      if (el('scTotalLabel'))      el('scTotalLabel').textContent     = 'terkumpul';
      // Admin verifikasi: sembunyikan ringkasan bulan (khusus warga)
      var _ms = el('wargaMonthSummary'); if (_ms) _ms.classList.add('hidden');
    } else {
      // Warga: filter by their own email only
      var myEmail = currentUser && currentUser.email ? currentUser.email.trim().toLowerCase() : '';
      var wargaPending   = (dashboardPendingCache   || []).filter(function(i) { return (i.email || '').toLowerCase() === myEmail; });
      var wargaConfirmed = (dashboardConfirmedCache || []).filter(function(i) { return (i.email || '').toLowerCase() === myEmail; });
      var wargaPendingAmt   = wargaPending.reduce(function(s, i)   { return s + Number(i.nominal || 0); }, 0);
      var wargaConfirmedAmt = wargaConfirmed.reduce(function(s, i) { return s + Number(i.nominal || 0); }, 0);
      var wargaTotalAmt = wargaPendingAmt + wargaConfirmedAmt;

      if (el('scPendingLabel'))    el('scPendingLabel').textContent   = 'Pending';
      if (el('scPendingCount'))    el('scPendingCount').textContent   = wargaPending.length;
      if (el('scPendingAmount'))   el('scPendingAmount').textContent  = fmt(wargaPendingAmt);
      if (el('scConfirmedLabel'))  el('scConfirmedLabel').textContent = 'Confirmed';
      if (el('scConfirmedCount'))  el('scConfirmedCount').textContent = wargaConfirmed.length;
      if (el('scConfirmedAmount')) el('scConfirmedAmount').textContent = fmt(wargaConfirmedAmt);
      if (el('scTotalAmount'))     el('scTotalAmount').textContent    = fmt(wargaTotalAmt);
      if (el('scTotalLabel'))      el('scTotalLabel').textContent     = 'total submit';

      // Make scorecard cards clickable as filters
      _bindWargaScorecard_();

      // Ringkasan status pembayaran per bulan (kalender mini)
      _renderWargaMonthSummary_(wargaPending, wargaConfirmed);
    }
  }

  // State tahun terpilih untuk ringkasan bulan warga
  var _wargaSummaryYear_ = null;

  // Render kalender mini status pembayaran warga (hijau=lunas, kuning=pending, abu=belum)
  function _renderWargaMonthSummary_(pendingArr, confirmedArr) {
    var box = document.getElementById('wargaMonthSummary');
    if (!box) return;

    var MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    function monthIdx(b) {
      var s = String(b || '').trim().toLowerCase().slice(0, 3);
      for (var i = 0; i < MONTHS.length; i++) {
        if (MONTHS[i].toLowerCase() === s) return i;
      }
      return -1;
    }

    // status per tahun: { '2026': { 4:'confirmed', 3:'pending' } }
    var byYear = {};
    function mark(arr, status) {
      (arr || []).forEach(function(it) {
        var yr = String(it.tahun || '').trim();
        var mi = monthIdx(it.bulan);
        if (!yr || mi < 0) return;
        if (!byYear[yr]) byYear[yr] = {};
        // confirmed menang atas pending
        if (byYear[yr][mi] !== 'confirmed') byYear[yr][mi] = status;
      });
    }
    mark(pendingArr, 'pending');
    mark(confirmedArr, 'confirmed');

    var years = Object.keys(byYear).sort(function(a, b) { return Number(b) - Number(a); });
    if (years.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }

    if (!_wargaSummaryYear_ || years.indexOf(_wargaSummaryYear_) === -1) {
      _wargaSummaryYear_ = years[0];
    }
    var yr = _wargaSummaryYear_;
    var statuses = byYear[yr] || {};

    var lunasCount = 0, pendingCount = 0;
    for (var k in statuses) {
      if (statuses[k] === 'confirmed') lunasCount++;
      else if (statuses[k] === 'pending') pendingCount++;
    }

    // Dropdown tahun (jika >1 tahun)
    var yearSelect = '';
    if (years.length > 1) {
      yearSelect =
        '<select onchange="setWargaSummaryYear(this.value)" ' +
        'class="text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 outline-none">' +
        years.map(function(y) {
          return '<option value="' + y + '"' + (y === yr ? ' selected' : '') + '>' + y + '</option>';
        }).join('') +
        '</select>';
    } else {
      yearSelect = '<span class="text-xs font-bold text-gray-900">' + yr + '</span>';
    }

    // Grid 12 bulan
    var cells = MONTHS.map(function(name, i) {
      var st = statuses[i];
      var cls, dot, clickable = '';
      if (st === 'confirmed') {
        cls = 'bg-blue-50 border-blue-200 text-blue-700';
        dot = '#3b82f6';
        clickable = ' onclick="wargaJumpMonth(\'' + name + '\',\'' + yr + '\')"';
      } else if (st === 'pending') {
        cls = 'bg-amber-50 border-amber-200 text-amber-700';
        dot = '#F59E0B';
        clickable = ' onclick="wargaJumpMonth(\'' + name + '\',\'' + yr + '\')"';
      } else {
        cls = 'bg-gray-50 border-gray-100 text-gray-300';
        dot = '#E5E7EB';
      }
      return '<div' + clickable + ' class="flex flex-col items-center justify-center gap-1 rounded-xl border py-2 ' +
        cls + (clickable ? ' cursor-pointer active:scale-95 transition' : '') + '">' +
        '<span class="w-1.5 h-1.5 rounded-full" style="background:' + dot + '"></span>' +
        '<span class="text-[11px] font-semibold leading-none">' + name + '</span>' +
        '</div>';
    }).join('');

    box.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5">' +
        '<div class="flex items-center justify-between mb-2.5">' +
          '<div class="flex items-center gap-2">' +
            '<p class="text-sm font-bold text-gray-900">Status Pembayaran</p>' +
            yearSelect +
          '</div>' +
          '<span class="text-[11px] font-semibold text-blue-600">' + lunasCount + '/12 lunas</span>' +
        '</div>' +
        '<div class="grid grid-cols-6 gap-1.5">' + cells + '</div>' +
        '<div class="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-gray-50">' +
          '<span class="flex items-center gap-1 text-[10px] text-gray-500"><span class="w-1.5 h-1.5 rounded-full" style="background:#3b82f6"></span>Lunas</span>' +
          '<span class="flex items-center gap-1 text-[10px] text-gray-500"><span class="w-1.5 h-1.5 rounded-full" style="background:#F59E0B"></span>Pending</span>' +
          '<span class="flex items-center gap-1 text-[10px] text-gray-500"><span class="w-1.5 h-1.5 rounded-full" style="background:#E5E7EB"></span>Belum bayar</span>' +
        '</div>' +
      '</div>';
    box.classList.remove('hidden');
  }

  // Ganti tahun ringkasan & re-render
  function setWargaSummaryYear(y) {
    _wargaSummaryYear_ = String(y);
    updateDashboardScorecards();
  }

  // Tap bulan → filter list ke bulan tsb via search bar
  function wargaJumpMonth(bulan, tahun) {
    var searchEl = document.getElementById('dashboardSearch');
    if (!searchEl) return;
    searchEl.value = bulan + ' ' + tahun;
    searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    var list = document.getElementById('dashboardList');
    if (list && list.scrollIntoView) {
      list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  var _wargaScorecardBound_ = false;
  function _bindWargaScorecard_() {
    if (_wargaScorecardBound_) return;
    _wargaScorecardBound_ = true;
    var sc = document.getElementById('dashboardScorecards');
    if (!sc) return;
    var cards = sc.querySelectorAll('.flex-1');
    // cards[0]=pending, cards[1]=confirmed, cards[2]=total
    var types = ['pending', 'confirmed', 'all'];
    cards.forEach(function(card, idx) {
      card.style.cursor = 'pointer';
      card.style.transition = 'opacity 0.15s, transform 0.15s';
      card.addEventListener('click', function() {
        if (navigator.vibrate) navigator.vibrate(20);
        wargaScoreFilter = types[idx];
        // Visual: highlight active card
        cards.forEach(function(c, i) {
          c.style.opacity = (i === idx) ? '1' : '0.5';
          c.style.transform = (i === idx) ? 'scale(1.03)' : 'scale(1)';
        });
        applyFilters();
      });
    });
  }

  function closeDashboard() {
    switchPage('homePage');
    if (activePolling) {
      clearInterval(activePolling);
      activePolling = null;
    }
    setActiveNavById('navHome');
  }

  // ================= COMING SOON MODAL =================
  function openComingSoon() {
    const modal = document.getElementById('comingSoon');
    const card = document.getElementById('comingSoonCard');

    if (!modal || !card) return;

    modal.classList.remove('hidden');

    requestAnimationFrame(() => {
      card.classList.remove('opacity-0', 'scale-95');
      card.classList.add('opacity-100', 'scale-100');
    });
  }

  function closeComingSoon() {
    const modal = document.getElementById('comingSoon');
    const card = document.getElementById('comingSoonCard');

    if (!modal || !card) return;

    card.classList.remove('opacity-100', 'scale-100');
    card.classList.add('opacity-0', 'scale-95');

    setTimeout(() => {
      modal.classList.add('hidden');
    }, 180);
  }

  function setActiveNavById(navId) {
    // Blur input/date field aktif sebelum pindah halaman — cegah native date
    // picker (kalender Android) nyangkut & "menangkap" tap navbar berikutnya
    var activeEl = document.activeElement;
    if (activeEl && activeEl !== document.body && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }

    // Old bottom nav
    const navItems = document.querySelectorAll('.nav-app');
    navItems.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(navId);
    if (activeBtn) activeBtn.classList.add('active');
    // New desktop sidebar
    document.querySelectorAll('.dsk-nav').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelectorAll('.dsk-nav[data-navid="' + navId + '"]').forEach(btn => {
      if (!btn.classList.contains('dsk-nav-cta') && !btn.classList.contains('dsk-nav-logout')) {
        btn.classList.add('active');
      }
    });
  }

  function _updateDesktopSidebarProfile_() {
    var logoutBtn = document.getElementById('dskNavLogout');
    if (!currentUser) {
      if (logoutBtn) logoutBtn.classList.add('hidden');
      // Clear + hide desktop topbar profile
      var tp = document.getElementById('desktopTopbarProfile');
      if (tp) tp.classList.add('hidden');
      var tav = document.getElementById('desktopTopbarAvatar');
      var tnm = document.getElementById('desktopTopbarName');
      var trl = document.getElementById('desktopTopbarRole');
      if (tav) tav.textContent = '';
      if (tnm) tnm.textContent = '';
      if (trl) trl.textContent = '';
      // Clear sidebar profile
      var profile = document.getElementById('desktopSidebarProfile');
      if (profile) profile.classList.add('hidden');
      // Hide admin nav
      var adminBtn = document.getElementById('dskNavAdmin');
      if (adminBtn) adminBtn.classList.add('hidden');
      return;
    }
    var name = currentUser.fullName || currentUser.name || currentUser.email || '';
    var role = currentUser.role === 'admin' ? 'Administrator' : 'Warga';
    var initial = name.trim().charAt(0).toUpperCase() || '?';
    var colors = ['#E53935','#8E24AA','#1E88E5','#00ACC1','#2563eb','#FB8C00','#6D4C41','#546E7A','#D81B60','#3949AB'];
    var color = colors[(name.charCodeAt(0) || 0) % colors.length];

    // Sidebar profile
    var profile = document.getElementById('desktopSidebarProfile');
    if (profile) {
      profile.classList.remove('hidden');
      var av = document.getElementById('desktopSidebarAvatar');
      var nm = document.getElementById('desktopSidebarName');
      var rl = document.getElementById('desktopSidebarRole');
      if (av) { av.textContent = initial; av.style.background = color; }
      if (nm) nm.textContent = name;
      if (rl) rl.textContent = role;
    }

    // Topbar profile (right) — show when logged in
    var tp  = document.getElementById('desktopTopbarProfile');
    if (tp)  { tp.classList.remove('hidden'); tp.classList.add('flex'); }
    var tav = document.getElementById('desktopTopbarAvatar');
    var tnm = document.getElementById('desktopTopbarName');
    var trl = document.getElementById('desktopTopbarRole');
    if (tav) { tav.textContent = initial; tav.style.background = color; }
    if (tnm) tnm.textContent = name;
    if (trl) trl.textContent = role;

    // Topbar greeting (left) — sync from home page greeting els
    var greetSrc = document.getElementById('homeGreeting');
    var userSrc  = document.getElementById('homeUsername');
    var tg = document.getElementById('desktopTopbarGreeting');
    if (tg && greetSrc) tg.innerHTML = greetSrc.innerHTML;

    // Admin button
    var adminBtn = document.getElementById('dskNavAdmin');
    if (adminBtn) {
      if (currentUser.role === 'admin') adminBtn.classList.remove('hidden');
      else adminBtn.classList.add('hidden');
    }

    // Logout button — show only when logged in
    var logoutBtn = document.getElementById('dskNavLogout');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  }

  function openLoginModal() {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('loginStepEmail').classList.remove('hidden');
    document.getElementById('loginStepOTP').classList.add('hidden');
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('otpError').classList.add('hidden');
  }

  var _loginModalEmail_ = '';

  function requestOTP() {
    const email = document.getElementById('loginEmailInput').value.trim();
    const errorEl = document.getElementById('loginError');

    if (!email) {
      errorEl.innerText = 'Email wajib diisi';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = document.querySelector('#loginStepEmail button');
    btn.disabled = true;

    // Stage 1
    btn.innerHTML = `
      <span class="flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"
            stroke="white" stroke-width="3"
            fill="none" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"
            stroke="white" stroke-width="3"
            fill="none"/>
        </svg>
        Memeriksa email...
      </span>
    `;

    // Delay kecil agar terasa proses validasi
    setTimeout(() => {
      btn.innerHTML = `
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"
              stroke="white" stroke-width="3"
              fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"
              stroke="white" stroke-width="3"
              fill="none"/>
          </svg>
          Mengirim OTP...
        </span>
      `;
    }, 600);

    gasPost_('requestLoginOTP', { identifier: email })
      .then(function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Kirim OTP';
        if (!res.success) {
          errorEl.innerText = res.message;
          errorEl.classList.remove('hidden');
          return;
        }
        _loginModalEmail_ = res.email || email;
        document.getElementById('loginStepEmail').classList.add('hidden');
        document.getElementById('loginStepOTP').classList.remove('hidden');
      })
      .catch(function() {
        errorEl.innerText = 'Gagal mengirim OTP';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = 'Kirim OTP';
      });
  }

  /* ======================================
    LOGIN VIA PAGE SAYA
  ====================================== */
  function requestOTPSaya() {

    const email = document
      .getElementById('sayaEmailInput')
      ?.value.trim();

    const errorEl =
      document.getElementById('sayaEmailError');

    const btn = document.getElementById('requestOTPBtn');
    // reset error
    errorEl.classList.add('hidden');

    if (!email) {
      var errSpan = errorEl.querySelector('span');
      if (errSpan) errSpan.innerText = 'Email wajib diisi';
      errorEl.classList.remove('hidden');
      var inputEl = document.getElementById('sayaEmailInput');
      triggerInputError(inputEl);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Memeriksa...</span>';

    gasGet_('checkLoginIdentifier', { identifier: email })
      .then(function(pinRes) {
        if (!pinRes || !pinRes.success) {
          btn.disabled = false;
          btn.innerHTML = 'Masuk';
          var errSpan = errorEl.querySelector('span');
          if (errSpan) errSpan.innerText = pinRes && pinRes.message ? pinRes.message : 'Akun tidak ditemukan di sistem';
          errorEl.classList.remove('hidden');
          var emailCard = document.getElementById('sayaEmailInput')?.closest('.bg-white');
          if (emailCard) shakeField(emailCard);
          if (navigator.vibrate) navigator.vibrate(40);
          return;
        }
        btn.disabled = false;
        btn.innerHTML = 'Masuk';
        // Simpan konteks login: email kanonik + channel (email/wa) + target tersamar
        _loginCtx_ = {
          identifier: email,
          email: pinRes.email || email,
          channel: pinRes.channel || 'email',
          maskedTarget: pinRes.maskedTarget || '',
          note: pinRes.note || ''
        };
        if (pinRes.hasPIN) {
          showLoginMethodStep_(_loginCtx_.email);
        } else {
          proceedSendOTP_(_loginCtx_.identifier);
        }
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Masuk';
        var errSpan = errorEl.querySelector('span');
        if (errSpan) errSpan.innerText = 'Gagal memeriksa akun';
        errorEl.classList.remove('hidden');
        var emailCard = document.getElementById('sayaEmailInput')?.closest('.bg-white');
        if (emailCard) shakeField(emailCard);
        if (navigator.vibrate) navigator.vibrate(40);
      });
  }

  function proceedSendOTP_(identifier) {
    _sayaOTPMode_ = 'first_otp';
    var btn = document.getElementById('requestOTPBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Mengirim OTP...</span>';

    gasPost_('requestLoginOTP', { identifier: identifier })
      .then(function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Kirim Kode OTP';
        if (!res || !res.success) {
          var errorEl = document.getElementById('sayaEmailError');
          if (errorEl) {
            var errSpan = errorEl.querySelector('span');
            if (errSpan) errSpan.innerText = res && res.message ? res.message : 'Gagal mengirim OTP';
            errorEl.classList.remove('hidden');
          }
          return;
        }
        var emailStep = document.getElementById('sayaStepEmail');
        var otpStep   = document.getElementById('sayaStepOTP');
        emailStep.style.opacity = '0';
        emailStep.style.transform = 'translateY(6px)';
        emailStep.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
        setTimeout(function() {
          emailStep.classList.add('hidden');
          emailStep.style.opacity = '';
          emailStep.style.transform = '';
          otpStep.classList.remove('hidden');
          otpStep.style.display = 'flex';
          otpStep.style.flexDirection = 'column';
          otpStep.style.height = '100%';
          otpStep.style.overflowY = 'auto';
          otpStep.classList.add('saya-step');
          setTimeout(function() { otpStep.classList.remove('saya-step'); }, 300);
        }, 180);
        if (res.email) _loginCtx_.email = res.email;
        if (res.channel) _loginCtx_.channel = res.channel;
        if (res.maskedTarget) _loginCtx_.maskedTarget = res.maskedTarget;
        _loginCtx_.note = res.note || '';
        _setOTPSentTo_();
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Kirim Kode OTP';
        var errorEl = document.getElementById('sayaEmailError');
        if (errorEl) {
          var errSpan = errorEl.querySelector('span');
          if (errSpan) errSpan.innerText = 'Gagal mengirim OTP, coba lagi';
          errorEl.classList.remove('hidden');
        }
      });
  }

  function showLoginMethodStep_(email) {
    var emailStep = document.getElementById('sayaStepEmail');
    var methodStep = document.getElementById('sayaStepMethod');
    if (!methodStep) return;
    emailStep.classList.add('hidden');
    methodStep.style.display = '';
    methodStep.classList.remove('hidden');
    var methodEmail = document.getElementById('sayaMethodEmail');
    if (methodEmail) methodEmail.innerText = email;
    // Label tombol "Kirim OTP" mengikuti channel (Email / WhatsApp)
    var otpBtn = document.getElementById('sayaKirimOTPBtn');
    if (otpBtn) {
      var lbl = 'Kirim OTP ke ' + _channelLabel_(_loginCtx_.channel);
      // pertahankan ikon, ganti teks setelah </svg>
      var svgEnd = otpBtn.innerHTML.indexOf('</svg>');
      if (svgEnd !== -1) {
        otpBtn.innerHTML = otpBtn.innerHTML.substring(0, svgEnd + 6) + ' ' + lbl;
      } else {
        otpBtn.innerText = lbl;
      }
    }
  }

  async function hashPIN_(pin) {
    var msgBuffer = new TextEncoder().encode(pin);
    var hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function loginWithPINSaya() {
    var email = _loginEmail_();
    var pinVal = document.getElementById('sayaPINLoginInput')
      ? document.getElementById('sayaPINLoginInput').value.trim() : '';
    var errorEl = document.getElementById('sayaPINLoginError');
    if (!pinVal || pinVal.length !== 6) {
      if (errorEl) { errorEl.innerText = 'PIN harus 6 digit'; errorEl.classList.remove('hidden'); }
      return;
    }
    var btn = document.getElementById('sayaPINLoginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Memverifikasi...</span>';
    hashPIN_(pinVal).then(function(pinHash) {
      return gasPost_('verifyPIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false;
      btn.innerHTML = 'Masuk dengan PIN';
      if (!res || !res.success) {
        if (res && res.message === 'PIN belum dibuat') {
          // Akun belum punya PIN sendiri — arahkan ke OTP dulu, lalu tawarkan buat PIN baru
          if (errorEl) errorEl.classList.add('hidden');
          _setCodeState_(document.getElementById('sayaPINBoxes'), null);
          _switchToOTPForCreatePIN_();
          return;
        }
        if (errorEl) { errorEl.innerText = res && res.message ? res.message : 'PIN salah'; errorEl.classList.remove('hidden'); }
        if (navigator.vibrate) navigator.vibrate(40);
        // Animasi gagal (shake merah) lalu kosongkan kotak
        var _pinC = document.getElementById('sayaPINBoxes');
        _setCodeState_(_pinC, 'error');
        setTimeout(function(){ _clearCodeBoxes_(_pinC, document.getElementById('sayaPINLoginInput')); }, 1100);
        return;
      }
      // Login berhasil — animasi sukses (merge → centang), tunda navigasi agar terlihat
      _setCodeState_(document.getElementById('sayaPINBoxes'), 'success');
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      setTimeout(function() {
      currentUser = res.user;
      saveSession(res.user);
      updateHeaderAuthUI();
      initNotifications();
      var otpStepEl = document.getElementById('sayaStepMethod');
      if (otpStepEl) { otpStepEl.classList.add('hidden'); otpStepEl.style.display = ''; otpStepEl.style.height = ''; }
      var emailStepEl = document.getElementById('sayaStepEmail');
      if (emailStepEl) { emailStepEl.classList.add('hidden'); emailStepEl.style.display = ''; emailStepEl.style.height = ''; }
      document.getElementById('sayaProfileName').innerText = res.user.fullName || 'User';
      document.getElementById('sayaProfileEmail').innerText = res.user.email;
      _renderProfileAvatar_(res.user.fullName || 'User');
      var loggedInView = document.getElementById('sayaLoggedInView');
      if (loggedInView) {
        loggedInView.classList.remove('hidden');
        loggedInView.style.display = 'flex';
        loggedInView.style.flexDirection = 'column';
        loggedInView.style.flex = '1';
        loggedInView.style.minHeight = '0';
      }
      document.body.classList.remove('saya-open');
      switchPage('homePage');
      setActiveNavById('navHome');
      loadHomeData();
      gasGet_('getCurrentUserDataWarga', { email: res.user.email }).then(function(wRes) {
        if (!currentUser) return;
        if (!wRes || !wRes.success) return;
        currentUser.wargaData = wRes.data || [];
        saveSession(currentUser);
        _renderSayaWargaData_(wRes);
        setTimeout(function() { showToast('Anda telah login', 'success'); }, 300);
      });
      }, 600);
    }).catch(function() {
      btn.disabled = false;
      btn.innerHTML = 'Masuk dengan PIN';
      if (errorEl) { errorEl.innerText = 'Verifikasi gagal'; errorEl.classList.remove('hidden'); }
      var _pinC = document.getElementById('sayaPINBoxes');
      _setCodeState_(_pinC, 'error');
      setTimeout(function(){ _clearCodeBoxes_(_pinC, document.getElementById('sayaPINLoginInput')); }, 1100);
    });
  }

  // 'login' | 'reset_pin' | 'first_otp'
  var _sayaOTPMode_ = 'login';

  /* Konteks login hasil resolve identifier (email/blok/no hp) */
  var _loginCtx_ = { identifier: '', email: '', channel: 'email', maskedTarget: '', note: '' };

  function _channelLabel_(ch) { return ch === 'wa' ? 'WhatsApp' : 'Email'; }

  /* Email kanonik untuk verify OTP/PIN — bukan raw input (yg bisa blok/no hp) */
  function _loginEmail_() {
    if (_loginCtx_ && _loginCtx_.email) return _loginCtx_.email;
    var el = document.getElementById('sayaEmailInput');
    return el ? el.value.trim() : '';
  }

  /* Set teks "Kode dikirim ke ... via ..." sesuai channel */
  function _setOTPSentTo_() {
    var sentTo = document.getElementById('otpSentTo');
    if (!sentTo) return;
    var target = _loginCtx_.maskedTarget || _loginCtx_.email || '';
    sentTo.innerHTML = 'Kode dikirim ke <span class="text-primary font-semibold">' + target +
      '</span> via ' + _channelLabel_(_loginCtx_.channel);

    var notice = document.getElementById('otpOwnerNotice');
    if (notice) {
      if (_loginCtx_.note) {
        notice.textContent = _loginCtx_.note;
        notice.classList.remove('hidden');
      } else {
        notice.textContent = '';
        notice.classList.add('hidden');
      }
    }
  }

  function switchToOTPFromPIN_() {
    _sayaOTPMode_ = 'login';
    var methodStep = document.getElementById('sayaStepMethod');
    var emailStep = document.getElementById('sayaStepEmail');
    var identifier = _loginCtx_.identifier || _loginEmail_();
    var btnLabel = 'Kirim OTP ke ' + _channelLabel_(_loginCtx_.channel);

    // Kirim OTP dulu sebelum switch UI
    var otpBtn = document.getElementById('sayaKirimOTPBtn');
    if (otpBtn) {
      otpBtn.disabled = true;
      otpBtn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none"/></svg>Mengirim...</span>';
    }

    gasPost_('requestLoginOTP', { identifier: identifier })
      .then(function(res) {
        if (otpBtn) { otpBtn.disabled = false; otpBtn.innerHTML = btnLabel; }
        if (res && res.channel) _loginCtx_.channel = res.channel;
        if (res && res.maskedTarget) _loginCtx_.maskedTarget = res.maskedTarget;
        if (res && res.email) _loginCtx_.email = res.email;
        _loginCtx_.note = (res && res.note) || '';
        if (methodStep) { methodStep.classList.add('hidden'); methodStep.style.display = ''; methodStep.style.height = ''; }
        if (emailStep) { emailStep.classList.add('hidden'); emailStep.style.display = ''; emailStep.style.height = ''; }
        var otpStep = document.getElementById('sayaStepOTP');
        if (otpStep) {
          otpStep.classList.remove('hidden');
          otpStep.style.display = 'flex';
          otpStep.style.flexDirection = 'column';
          otpStep.style.height = '100%';
          otpStep.style.overflowY = 'auto';
        }
        _setOTPSentTo_();
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        if (otpBtn) { otpBtn.disabled = false; otpBtn.innerHTML = btnLabel; }
        showToast('Gagal mengirim OTP, coba lagi', 'error');
      });
  }

  /* Akun belum punya PIN — kirim OTP dulu, lalu tawarkan buat PIN baru */
  function _switchToOTPForCreatePIN_() {
    _sayaOTPMode_ = 'first_otp';
    var methodStep = document.getElementById('sayaStepMethod');
    var emailStep = document.getElementById('sayaStepEmail');
    var identifier = _loginCtx_.identifier || _loginEmail_();

    var btn = document.getElementById('sayaPINLoginBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Mengirim OTP...</span>';
    }

    showToast('PIN belum dibuat. Mengirim OTP untuk verifikasi...', 'info');

    gasPost_('requestLoginOTP', { identifier: identifier })
      .then(function(res) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Masuk dengan PIN'; }
        if (!res || !res.success) {
          showToast(res && res.message ? res.message : 'Gagal mengirim OTP', 'error');
          return;
        }
        if (res.channel) _loginCtx_.channel = res.channel;
        if (res.maskedTarget) _loginCtx_.maskedTarget = res.maskedTarget;
        if (res.email) _loginCtx_.email = res.email;
        _loginCtx_.note = res.note || '';
        if (methodStep) { methodStep.classList.add('hidden'); methodStep.style.display = ''; methodStep.style.height = ''; }
        if (emailStep) { emailStep.classList.add('hidden'); emailStep.style.display = ''; emailStep.style.height = ''; }
        var otpStep = document.getElementById('sayaStepOTP');
        if (otpStep) {
          otpStep.classList.remove('hidden');
          otpStep.style.display = 'flex';
          otpStep.style.flexDirection = 'column';
          otpStep.style.height = '100%';
          otpStep.style.overflowY = 'auto';
        }
        _setOTPSentTo_();
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Masuk dengan PIN'; }
        showToast('Gagal mengirim OTP, coba lagi', 'error');
      });
  }

  function openCreatePINModal() {
    var modal = document.getElementById('createPINModal');
    if (!modal) return;
    document.getElementById('createPINInput').value = '';
    document.getElementById('createPINConfirm').value = '';
    document.getElementById('createPINError').classList.add('hidden');
    modal.classList.remove('hidden');
  }

  function closeCreatePINModal() {
    var modal = document.getElementById('createPINModal');
    if (modal) modal.classList.add('hidden');
  }

  function submitCreatePIN() {
    var pin1 = document.getElementById('createPINInput').value.trim();
    var pin2 = document.getElementById('createPINConfirm').value.trim();
    var errorEl = document.getElementById('createPINError');
    errorEl.classList.add('hidden');
    if (pin1.length !== 6 || !/^\d{6}$/.test(pin1)) {
      errorEl.innerText = 'PIN harus 6 digit angka'; errorEl.classList.remove('hidden'); return;
    }
    if (pin1 !== pin2) {
      errorEl.innerText = 'Konfirmasi PIN tidak cocok'; errorEl.classList.remove('hidden'); return;
    }
    var btn = document.getElementById('createPINSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><svg style="width:16px;height:16px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3"/></svg>Menyimpan...</span>';
    var email = currentUser ? currentUser.email : '';
    hashPIN_(pin1).then(function(pinHash) {
      return gasPost_('savePIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false;
      btn.innerText = 'Simpan PIN';
      if (!res || !res.success) {
        errorEl.innerText = res && res.message ? res.message : 'Gagal menyimpan PIN';
        errorEl.classList.remove('hidden'); return;
      }
      closeCreatePINModal();
      showToast('PIN berhasil disimpan 🔐', 'success');
    }).catch(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan PIN';
      errorEl.innerText = 'Gagal menyimpan PIN'; errorEl.classList.remove('hidden');
    });
  }

  function verifyOTPSaya() {
    var email = _loginEmail_();

    var otp = document.getElementById('sayaOTPInput')
                ? document.getElementById('sayaOTPInput').value.trim()
                : '';

    var errorEl = document.getElementById('sayaOTPError');

    if (!otp || otp.length !== 6) {
      errorEl.innerText = 'OTP harus 6 digit';
      errorEl.classList.remove('hidden');
      return;
    }

    var btn = document.getElementById('verifyOTPBtn');

    btn.disabled = true;
    btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px">'
      + '<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">'
      + '<circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/>'
      + '<path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/>'
      + '</svg>Memverifikasi...</span>';

    gasPost_('verifyLoginOTP', { email: email, otp: otp })
      .then(function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        if (!res.success) {
          errorEl.innerText = res.message || 'OTP tidak valid';
          errorEl.classList.remove('hidden');
          if (navigator.vibrate) navigator.vibrate(40);
          var _otpC = document.getElementById('sayaOTPBoxes');
          _setCodeState_(_otpC, 'error');
          setTimeout(function(){ _clearCodeBoxes_(_otpC, document.getElementById('sayaOTPInput')); }, 1100);
          return;
        }
        _setCodeState_(document.getElementById('sayaOTPBoxes'), 'success');
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
        setTimeout(function() {
          currentUser = res.user;
          saveSession(res.user);
          updateHeaderAuthUI();
          initNotifications();
          _afterOTPVerified_(res.user);
        }, 600);
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        errorEl.innerText = 'Verifikasi gagal';
        errorEl.classList.remove('hidden');
        var _otpC = document.getElementById('sayaOTPBoxes');
        _setCodeState_(_otpC, 'error');
        setTimeout(function(){ _clearCodeBoxes_(_otpC, document.getElementById('sayaOTPInput')); }, 1100);
      });
  }

  /* Render data Blok/Nama/HP/Email + badge Status Hunian di menu "Me" */
  function _renderSayaWargaData_(wRes) {
    if (!wRes || !wRes.success || !wRes.data || !wRes.data.length) return;
    var listEl  = document.getElementById('sayaBlokList');
    var namaEl  = document.getElementById('sayaNamaInput');
    var hpEl    = document.getElementById('sayaHpInput');
    var emailEl = document.getElementById('sayaEmailEditInput');
    var badgeEl = document.getElementById('sayaProfileRoleBadge');
    if (listEl) {
      listEl.innerHTML = '';
      var blokStr = wRes.data.map(function(d) { return d.blok || ''; }).filter(Boolean).join(', ');
      var div = document.createElement('div');
      div.innerText = blokStr || '—';
      listEl.appendChild(div);
    }
    if (namaEl)  namaEl.value  = wRes.data[0].nama  || '';
    if (hpEl)    hpEl.value    = wRes.data[0].noHp  || '';
    if (emailEl) emailEl.value = wRes.data[0].email || '';
    if (badgeEl) {
      var statusHunian = String(wRes.data[0].statusHunian || '').trim().toLowerCase();
      badgeEl.classList.remove('bg-amber-100', 'text-amber-700', 'bg-blue-100', 'text-blue-700');
      if (statusHunian === 'penyewa') {
        badgeEl.textContent = 'Penyewa';
        badgeEl.classList.add('bg-amber-100', 'text-amber-700');
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.textContent = 'Pemilik';
        badgeEl.classList.add('bg-blue-100', 'text-blue-700');
        badgeEl.classList.remove('hidden');
      }
    }
    _checkKelolaPenyewaMenu_();
  }

  /* ===== KELOLA PENYEWA (Pemilik kelola data Penyewa) ===== */
  var _myPenyewaBloks_ = [];

  function _checkKelolaPenyewaMenu_() {
    // Hanya PEMILIK yang lihat "Kelola Penyewa". getMyPenyewaBloks mengembalikan
    // blok-milik (baris non-penyewa) → kosong utk penyewa murni → menu disembunyikan.
    // Reset hidden dulu agar deterministik (anti flicker).
    var group = document.getElementById('sayaPropertiGroup');
    _myPenyewaBloks_ = [];
    if (group) group.classList.add('hidden');
    if (!group || !currentUser || !currentUser.email) return Promise.resolve();
    return gasGet_('getMyPenyewaBloks', { email: currentUser.email })
      .then(function(res) {
        if (!res || !res.ok || !res.data || !res.data.length) return; // bukan pemilik → tetap hidden
        _myPenyewaBloks_ = res.data;
        group.classList.remove('hidden');
      })
      .catch(function() {});
  }

  function openKelolaPenyewaModal() {
    var modal = document.getElementById('kelolaPenyewaModal');
    var listEl = document.getElementById('kelolaPenyewaList');
    if (!modal || !listEl) return;

    modal.classList.remove('hidden');
    if (!currentUser || !currentUser.email) {
      listEl.innerHTML = '<div class="text-center text-sm text-gray-400 py-8">Silakan login dulu.</div>';
      return;
    }
    // Selalu ambil data terbaru saat dibuka (anti-stale)
    listEl.innerHTML = '<div class="text-center text-sm text-gray-400 py-8">Memuat data...</div>';
    gasGet_('getMyPenyewaBloks', { email: currentUser.email })
      .then(function(res) {
        _myPenyewaBloks_ = (res && res.ok && res.data) ? res.data : [];
        _renderKelolaPenyewaList_();
      })
      .catch(function() {
        listEl.innerHTML = '<div class="text-center text-sm text-red-400 py-8">Gagal memuat data. Coba lagi.</div>';
      });
  }

  function _renderKelolaPenyewaList_() {
    var listEl = document.getElementById('kelolaPenyewaList');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!_myPenyewaBloks_.length) {
      listEl.innerHTML = '<div class="text-center py-8 px-4">'
        + '<div class="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">'
        +   '<svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
        + '</div>'
        + '<p class="text-sm font-semibold text-gray-700">Belum ada rumah terdaftar</p>'
        + '<p class="text-xs text-gray-400 mt-1 leading-relaxed">Fitur ini untuk pemilik mengelola penyewa. Jika Anda pemilik tapi rumah belum tercatat, hubungi pengurus.</p>'
        + '</div>';
      return;
    }

    _myPenyewaBloks_.forEach(function(item) {
      var card = document.createElement('div');
      card.className = 'bg-gray-50 rounded-2xl px-4 py-3 space-y-2';

      var header = document.createElement('div');
      header.className = 'flex items-center justify-between';
      var blokTitle = document.createElement('p');
      blokTitle.className = 'text-sm font-bold text-gray-900';
      blokTitle.innerText = 'Blok ' + item.blok;
      header.appendChild(blokTitle);
      card.appendChild(header);

      if (item.current) {
        var cur = document.createElement('div');
        cur.className = 'text-xs text-gray-500';
        cur.innerHTML = '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">PENYEWA AKTIF</span>'
          + '<div class="mt-1 text-gray-700">' + _escapeHtml_(item.current.nama) + '</div>'
          + '<div class="text-gray-400">' + _escapeHtml_(item.current.noHp) + ' · ' + _escapeHtml_(item.current.email) + '</div>';
        card.appendChild(cur);
      } else {
        var none = document.createElement('div');
        none.className = 'text-xs text-gray-400';
        none.innerText = 'Belum ada penyewa aktif';
        card.appendChild(none);
      }

      if (item.pending) {
        var pend = document.createElement('div');
        pend.className = 'text-xs text-gray-500';
        pend.innerHTML = '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">MENUNGGU AKTIVASI</span>'
          + '<div class="mt-1 text-gray-700">' + _escapeHtml_(item.pending.nama) + '</div>'
          + '<div class="text-gray-400">' + _escapeHtml_(item.pending.noHp) + ' · ' + _escapeHtml_(item.pending.email) + '</div>';
        card.appendChild(pend);
      }

      var btnRow = document.createElement('div');
      btnRow.className = 'flex gap-2';

      var btn = document.createElement('button');
      btn.className = 'flex-1 bg-primary text-white py-2.5 rounded-xl font-semibold text-xs active:scale-95 transition';
      btn.innerText = item.current || item.pending ? 'Ganti Penyewa' : 'Tambah Penyewa';
      btn.onclick = function() { openFormPenyewaModal(item.blok); };
      btnRow.appendChild(btn);

      if (item.current) {
        var delBtn = document.createElement('button');
        delBtn.className = 'flex-1 bg-red-50 text-red-600 py-2.5 rounded-xl font-semibold text-xs active:scale-95 transition';
        delBtn.innerText = 'Hapus Penyewa';
        delBtn.onclick = function() { removePenyewa(item.blok); };
        btnRow.appendChild(delBtn);
      }

      card.appendChild(btnRow);

      listEl.appendChild(card);
    });
  }

  function closeKelolaPenyewaModal() {
    var modal = document.getElementById('kelolaPenyewaModal');
    if (modal) modal.classList.add('hidden');
  }

  function _escapeHtml_(s) {
    var div = document.createElement('div');
    div.innerText = s == null ? '' : String(s);
    return div.innerHTML;
  }

  var _formPenyewaBlok_ = '';

  function openFormPenyewaModal(blok) {
    _formPenyewaBlok_ = blok;
    document.getElementById('formPenyewaBlok').value = blok;
    document.getElementById('formPenyewaNama').value = '';
    document.getElementById('formPenyewaWa').value = '';
    document.getElementById('formPenyewaEmail').value = '';
    document.getElementById('formPenyewaError').classList.add('hidden');
    document.getElementById('formPenyewaModal').classList.remove('hidden');
  }

  function closeFormPenyewaModal() {
    var modal = document.getElementById('formPenyewaModal');
    if (modal) modal.classList.add('hidden');
  }

  function submitFormPenyewa() {
    var nama  = document.getElementById('formPenyewaNama').value.trim();
    var wa    = document.getElementById('formPenyewaWa').value.trim();
    var email = document.getElementById('formPenyewaEmail').value.trim().toLowerCase();
    var errorEl = document.getElementById('formPenyewaError');
    errorEl.classList.add('hidden');

    if (!nama || !wa || !email) {
      errorEl.innerText = 'Semua field wajib diisi'; errorEl.classList.remove('hidden'); return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      errorEl.innerText = 'Format email tidak valid'; errorEl.classList.remove('hidden'); return;
    }
    if (!/^0\d{8,13}$/.test(wa)) {
      errorEl.innerText = 'Format No. WhatsApp tidak valid'; errorEl.classList.remove('hidden'); return;
    }

    var btn = document.getElementById('formPenyewaSubmitBtn');
    var btnText = document.getElementById('formPenyewaBtnText');
    var spinner = document.getElementById('formPenyewaSpinner');
    btn.disabled = true;
    btnText.innerText = 'Mengirim...';
    spinner.classList.remove('hidden');

    gasPost_('submitPenyewaByPemilik', {
      payload: {
        pemilikEmail: currentUser.email,
        blok: _formPenyewaBlok_,
        nama: nama,
        wa: wa,
        email: email
      }
    }).then(function(res) {
      btn.disabled = false;
      btnText.innerText = 'Kirim ke Pengurus';
      spinner.classList.add('hidden');
      if (!res || !res.ok) {
        errorEl.innerText = res && res.message ? res.message : 'Gagal mengirim data';
        errorEl.classList.remove('hidden'); return;
      }
      closeFormPenyewaModal();
      closeKelolaPenyewaModal();
      showToast('Data penyewa terkirim, menunggu aktivasi Pengurus', 'success');
      _checkKelolaPenyewaMenu_();
    }).catch(function() {
      btn.disabled = false;
      btnText.innerText = 'Kirim ke Pengurus';
      spinner.classList.add('hidden');
      errorEl.innerText = 'Gagal mengirim data'; errorEl.classList.remove('hidden');
    });
  }

  function removePenyewa(blok) {
    if (!confirm('Hapus penyewa aktif untuk blok ' + blok + '? Akun penyewa ini akan dinonaktifkan.')) return;
    gasPost_('removePenyewaByPemilik', {
      payload: { pemilikEmail: currentUser.email, blok: blok }
    }).then(function(res) {
      if (!res || !res.ok) {
        showToast(res && res.message ? res.message : 'Gagal menghapus penyewa', 'error');
        return;
      }
      showToast('Penyewa berhasil dinonaktifkan', 'success');
      closeKelolaPenyewaModal();
      _checkKelolaPenyewaMenu_().then(function() { openKelolaPenyewaModal(); });
    }).catch(function() {
      showToast('Gagal menghapus penyewa', 'error');
    });
  }

  /* ===== OTP MODE: SWITCH TO RESET PIN ===== */
  function switchToResetPINViaOTP_() {
    _sayaOTPMode_ = 'reset_pin';
    var methodStep = document.getElementById('sayaStepMethod');
    var emailStep  = document.getElementById('sayaStepEmail');
    var identifier = _loginCtx_.identifier || _loginEmail_();
    var btn = document.getElementById('sayaLupaPINBtn');
    if (btn) { btn.disabled = true; btn.innerText = 'Mengirim OTP...'; }
    gasPost_('requestLoginOTP', { identifier: identifier })
      .then(function(res) {
        if (btn) { btn.disabled = false; btn.innerText = 'Lupa PIN? Reset via OTP'; }
        if (res && res.channel) _loginCtx_.channel = res.channel;
        if (res && res.maskedTarget) _loginCtx_.maskedTarget = res.maskedTarget;
        if (res && res.email) _loginCtx_.email = res.email;
        _loginCtx_.note = (res && res.note) || '';
        if (methodStep) { methodStep.classList.add('hidden'); methodStep.style.display = ''; methodStep.style.height = ''; }
        if (emailStep) { emailStep.classList.add('hidden'); emailStep.style.display = ''; emailStep.style.height = ''; }
        var otpStep = document.getElementById('sayaStepOTP');
        if (otpStep) { otpStep.classList.remove('hidden'); otpStep.style.display = 'flex'; otpStep.style.flexDirection = 'column'; otpStep.style.height = '100%'; otpStep.style.overflowY = 'auto'; }
        _setOTPSentTo_();
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        if (btn) { btn.disabled = false; btn.innerText = 'Lupa PIN? Reset via OTP'; }
        showToast('Gagal mengirim OTP, coba lagi', 'error');
      });
  }

  /* ===== AFTER OTP VERIFIED — BRANCHING ===== */
  function _afterOTPVerified_(user) {
    if (_sayaOTPMode_ === 'reset_pin') {
      showResetPINStep_();
      return;
    }
    if (_sayaOTPMode_ === 'first_otp') {
      showPINOfferModal_();
      return;
    }
    _doLoginFromOTP_(user);
  }

  /* ===== SHARED LOGIN FLOW (after OTP / after PIN saved) ===== */
  function _doLoginFromOTP_(user) {
    ['sayaStepOTP','sayaStepMethod','sayaStepEmail','sayaStepResetPIN'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.style.display = ''; el.style.height = ''; el.style.flexDirection = ''; el.style.overflowY = ''; }
    });
    var profName = document.getElementById('sayaProfileName');
    var profEmail = document.getElementById('sayaProfileEmail');
    if (profName) profName.innerText = user.fullName || 'User';
    if (profEmail) profEmail.innerText = user.email;
    _renderProfileAvatar_(user.fullName || 'User');
    _updateDesktopSidebarProfile_();
    document.getElementById('sayaLoggedInView').classList.remove('hidden');
    document.body.classList.remove('saya-open');
    switchPage('homePage');
    setActiveNavById('navHome');
    loadHomeData();
    var badgeEl = document.getElementById('sayaProfileBlokBadge');
    if (badgeEl && user.blocks && user.blocks.length) badgeEl.innerText = 'Blok ' + user.blocks.join(', ');
    gasGet_('getCurrentUserDataWarga', { email: user.email })
      .then(function(wRes) {
        if (!currentUser) return;
        if (!wRes || !wRes.success) return;
        currentUser.wargaData = wRes.data || [];
        saveSession(currentUser);
        _renderSayaWargaData_(wRes);
        setTimeout(function() { showToast('Anda telah login', 'success'); }, 300);
      });
  }

  /* ===== RESET PIN STEP (wajib, dari "Lupa PIN") ===== */
  function showResetPINStep_() {
    var otpStep = document.getElementById('sayaStepOTP');
    if (otpStep) { otpStep.classList.add('hidden'); otpStep.style.display = ''; otpStep.style.height = ''; otpStep.style.overflowY = ''; }
    var step = document.getElementById('sayaStepResetPIN');
    if (step) { step.classList.remove('hidden'); step.style.display = 'flex'; step.style.height = '100%'; }
    var p1 = document.getElementById('resetPINInput');
    var p2 = document.getElementById('resetPINConfirm');
    var err = document.getElementById('resetPINError');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (err) { err.innerText = ''; err.classList.add('hidden'); }
  }

  function submitResetPIN_() {
    var pin1 = (document.getElementById('resetPINInput') || {}).value || '';
    var pin2 = (document.getElementById('resetPINConfirm') || {}).value || '';
    var errEl = document.getElementById('resetPINError');
    errEl.classList.add('hidden');
    if (!/^\d{6}$/.test(pin1.trim())) { errEl.innerText = 'PIN harus 6 digit angka'; errEl.classList.remove('hidden'); return; }
    if (pin1 !== pin2) { errEl.innerText = 'Konfirmasi PIN tidak cocok'; errEl.classList.remove('hidden'); return; }
    var btn = document.getElementById('resetPINSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><svg style="width:16px;height:16px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3"/></svg>Menyimpan...</span>';
    var email = currentUser ? currentUser.email : '';
    hashPIN_(pin1.trim()).then(function(pinHash) {
      return gasPost_('savePIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false; btn.innerText = 'Simpan PIN Baru';
      if (!res || !res.success) { errEl.innerText = res && res.message ? res.message : 'Gagal menyimpan PIN'; errEl.classList.remove('hidden'); return; }
      var step = document.getElementById('sayaStepResetPIN');
      if (step) { step.classList.add('hidden'); step.style.display = ''; step.style.height = ''; }
      showToast('PIN baru berhasil dibuat! 🔐', 'success');
      _doLoginFromOTP_(currentUser);
    }).catch(function() {
      btn.disabled = false; btn.innerText = 'Simpan PIN Baru';
      errEl.innerText = 'Gagal menyimpan PIN'; errEl.classList.remove('hidden');
    });
  }

  function skipResetPIN_() {
    var step = document.getElementById('sayaStepResetPIN');
    if (step) { step.classList.add('hidden'); step.style.display = ''; step.style.height = ''; }
    _doLoginFromOTP_(currentUser);
  }

  /* ===== PIN OFFER MODAL (opsional, untuk user tanpa PIN) ===== */
  function showPINOfferModal_() {
    var modal = document.getElementById('sayaPINOfferModal');
    if (!modal) { _doLoginFromOTP_(currentUser); return; }
    var p1 = document.getElementById('offerPINInput');
    var p2 = document.getElementById('offerPINConfirm');
    var err = document.getElementById('offerPINError');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (err) { err.innerText = ''; err.classList.add('hidden'); }
    modal.classList.remove('hidden');
  }

  function submitPINOffer_() {
    var pin1 = (document.getElementById('offerPINInput') || {}).value || '';
    var pin2 = (document.getElementById('offerPINConfirm') || {}).value || '';
    var errEl = document.getElementById('offerPINError');
    errEl.classList.add('hidden');
    if (!/^\d{6}$/.test(pin1.trim())) { errEl.innerText = 'PIN harus 6 digit angka'; errEl.classList.remove('hidden'); return; }
    if (pin1 !== pin2) { errEl.innerText = 'Konfirmasi PIN tidak cocok'; errEl.classList.remove('hidden'); return; }
    var btn = document.getElementById('offerPINSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><svg style="width:16px;height:16px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3"/></svg>Menyimpan...</span>';
    var email = currentUser ? currentUser.email : '';
    hashPIN_(pin1.trim()).then(function(pinHash) {
      return gasPost_('savePIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false; btn.innerText = 'Buat PIN Sekarang';
      if (!res || !res.success) { errEl.innerText = res && res.message ? res.message : 'Gagal menyimpan PIN'; errEl.classList.remove('hidden'); return; }
      var modal = document.getElementById('sayaPINOfferModal');
      if (modal) modal.classList.add('hidden');
      showToast('PIN berhasil dibuat! 🔐 Login lebih cepat mulai sekarang', 'success');
      _doLoginFromOTP_(currentUser);
    }).catch(function() {
      btn.disabled = false; btn.innerText = 'Buat PIN Sekarang';
      errEl.innerText = 'Gagal menyimpan PIN'; errEl.classList.remove('hidden');
    });
  }

  function skipPINOffer_() {
    var modal = document.getElementById('sayaPINOfferModal');
    if (modal) modal.classList.add('hidden');
    _doLoginFromOTP_(currentUser);
  }

  /* ===== INIT UI EVENTS ===== */
  document.addEventListener('DOMContentLoaded', function () {
    var sayaEmailInput = document.getElementById('sayaEmailInput');
    if (!sayaEmailInput) return;

    // Enter key → submit
    sayaEmailInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') requestOTPSaya();
    });

    // Auto-hide error saat field diketik/dikosongkan
    sayaEmailInput.addEventListener('input', function() {
      var errorEl = document.getElementById('sayaEmailError');
      if (!errorEl) return;
      if (!this.value.trim()) {
        errorEl.classList.add('hidden');
      } else {
        errorEl.classList.add('hidden');
      }
    });
  });

  function initOTPBoxes(){
    const boxes = document.querySelectorAll('.otp-box');
    boxes.forEach((box, index)=>{
      box.addEventListener('input', e => {
        const val = e.target.value.replace(/[^0-9]/g,'');
        box.value = val;
        if(val && boxes[index+1]){
          boxes[index+1].focus();
        }
        collectOTP();
        box.classList.toggle('filled', !!val);
      });

      box.addEventListener('keydown', e => {
        if(e.key === 'Backspace' && !box.value && boxes[index-1]){
          boxes[index-1].focus();
        }
      });

      // HANDLE PASTE
      box.addEventListener('paste', e => {
        const paste = (e.clipboardData || window.clipboardData)
          .getData('text')
          .replace(/[^0-9]/g,'');
        if(!paste) return;
        e.preventDefault();
        paste.split('').forEach((num, i)=>{
          if(boxes[i]){
            boxes[i].value = num;
          }
        });

        collectOTP();
        boxes.forEach(function(b) { b.classList.toggle('filled', !!b.value); });
        if(boxes[paste.length]){
          boxes[paste.length].focus();
        }
      });
    });
  }

  function collectOTP(){
    var boxes = document.querySelectorAll('.otp-box');
    var otp = '';
    boxes.forEach(function(b){
      otp += b.value || '';
    });
    document.getElementById('sayaOTPInput').value = otp;

    var _otpC = document.getElementById('sayaOTPBoxes');
    // Auto-submit saat 6 digit penuh
    if (otp.length === 6) {
      _setCodeState_(_otpC, 'verifying');
      setTimeout(function() {
        verifyOTPSaya();
      }, 120);
    } else {
      _setCodeState_(_otpC, null);
    }
  }

  function startOTPCountdown(){
    let time = 30;
    const label = document.getElementById('otpCountdown');
    const resendBtn = document.getElementById('resendOTPBtn');
    resendBtn.classList.add('cursor-not-allowed','text-gray-400');
    const timer = setInterval(()=>{
      time--;
      label.innerText =
        'Request kode baru dalam 00:' + String(time).padStart(2,'0');
      if(time <= 0){
        clearInterval(timer);
        label.innerText = '';
        resendBtn.classList.remove('cursor-not-allowed','text-gray-400');
        resendBtn.classList.add('text-primary','cursor-pointer');
        resendBtn.onclick = resendOTP;
      }
    },1000);
  }

  function resendOTP(){
    const btn = document.getElementById('resendOTPBtn');
    if(!btn) return;
    btn.classList.add('cursor-not-allowed');
    btn.onclick = null;

    // SPINNER
    btn.innerHTML = `
      <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"
          stroke="currentColor"
          stroke-width="3"
          fill="none"
          opacity="0.3"/>
        <path d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          stroke-width="3"
          fill="none"/>
      </svg>
      Mengirim...
    `;

    const identifier = _loginCtx_.identifier
      || document.getElementById('sayaEmailInput')?.value.trim();

    gasPost_('requestLoginOTP', { identifier: identifier })
      .then(function() {
        btn.innerHTML = '<svg class="w-3 h-3 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>OTP terkirim';
        setTimeout(function() {
          btn.innerHTML = "Kirim ulang";
          startOTPCountdown();
        }, 1000);
      })
      .catch(function() {
        btn.innerHTML = "Kirim ulang";
      });
  }

  function verifyOTP() {
    const email = _loginModalEmail_ || document.getElementById('loginEmailInput').value.trim();
    const otp = document.getElementById('loginOTPInput').value.trim();
    const errorEl = document.getElementById('otpError');

    if (!otp || otp.length !== 6) {
      errorEl.innerText = 'OTP harus 6 digit';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = document.querySelector('#loginStepOTP button');
    btn.disabled = true;
    btn.innerHTML = `
      <span class="flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"
            stroke="currentColor" stroke-width="3"
            fill="none" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"
            stroke="currentColor" stroke-width="3"
            fill="none"/>
        </svg>
        Memverifikasi...
      </span>
    `;

    gasPost_('verifyLoginOTP', { email: email, otp: otp })
      .then(function(res) {
        if (!res.success) {
          errorEl.innerText = res.message;
          errorEl.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = 'Verifikasi';
          return;
        }
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        currentUser = res.user;
        saveSession(res.user);
        updateHeaderAuthUI();
        initNotifications();
        loadHomeData();
        closeLoginModal();
        openHistory();
        showToast('Anda telah login','success');
      })
      .catch(function() {
        errorEl.innerText = 'Verifikasi gagal';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
      });
  }

  function logoutUserUI() {
    if (!currentUser) return;
    const email = currentUser.email;
    gasPost_('logoutUser', { email: email })
      .then(function() {
        currentUser = null;
        clearSession();
        dashboardCache = null;
        dashboardPendingCache = [];
        dashboardConfirmedCache = [];
        // Stop greeting typing animation
        _greetingToken_++;
        updateHeaderAuthUI();
        closeDashboard();
        if (typeof _renderSaldoKasCard_ === 'function') _renderSaldoKasCard_();
        showToast('Anda telah logout','success');
      })
      .catch(function() {
        showToast('Gagal logout','error');
      });
  }
  

  function openLogoutConfirm() {
    var modal = document.getElementById('logoutConfirmModal');
    var card  = document.getElementById('logoutConfirmCard');
    modal.classList.remove('hidden');
    setTimeout(function() {
      card.classList.remove('scale-95', 'opacity-0');
      card.classList.add('scale-100', 'opacity-100');
    }, 10);
  }

  function closeLogoutConfirm() {
    var modal = document.getElementById('logoutConfirmModal');
    var card  = document.getElementById('logoutConfirmCard');
    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(function() {
      modal.classList.add('hidden');
    }, 200);
  }

  function logoutSaya() {
    // Immediate feedback — disable button & show spinner
    var logoutBtn = document.querySelector('#logoutConfirmCard button:last-child');
    if (logoutBtn) {
      logoutBtn.disabled = true;
      logoutBtn.innerHTML = '<svg class="w-4 h-4 animate-spin inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M22 12a10 10 0 0 1-10 10"/></svg> Keluar...';
    }

    const emailToLogout = currentUser ? currentUser.email : null;

    function _doResetUI_() {
      // 1. Reset semua state DULU
      currentUser = null;
      clearSession(); // Hapus session dari localStorage
      wargaPaidMonths    = null;
      wargaPendingMonths = null;
      wargaRateByMonth   = null;
      userOverrideRateByYear = {};
      selectedMonthsByYear = {};
      homeDataCache.tunggakan = null;
      homeDataCache.contact = null;
      homeDataCache.security = null;
      dashboardCache = null;
      dashboardPendingCache = [];
      dashboardConfirmedCache = [];
      try { sessionStorage.removeItem('dashCache'); } catch(e) {}

      // 2. Update auth UI (tarif mask, header)
      updateHeaderAuthUI();

      // 3. Reset logout modal
      var logoutBtnReset = document.querySelector('#logoutConfirmCard button:last-child');
      if (logoutBtnReset) { logoutBtnReset.disabled = false; logoutBtnReset.innerHTML = 'Ya, Keluar'; }
      closeLogoutConfirm();
      document.body.classList.remove('saya-open');

      // 4. Reset step saya
      document.getElementById('sayaLoggedInView').classList.add('hidden');
      document.getElementById('sayaStepEmail').classList.remove('hidden');
      var _smReset = document.getElementById('sayaStepMethod');
      if (_smReset) { _smReset.classList.add('hidden'); _smReset.style.display = ''; _smReset.style.height = ''; }
      document.getElementById('sayaStepOTP').classList.add('hidden');
      document.getElementById('sayaEmailInput').value = '';
      document.getElementById('sayaOTPInput').value = '';
      var pinInput = document.getElementById('sayaPINLoginInput');
      if (pinInput) pinInput.value = '';
      if (typeof _clearCodeBoxes_ === 'function') _clearCodeBoxes_(document.getElementById('sayaPINBoxes'), pinInput);
      var pinError = document.getElementById('sayaPINLoginError');
      if (pinError) { pinError.innerText = ''; pinError.classList.add('hidden'); }
      var methodEmail = document.getElementById('sayaMethodEmail');
      if (methodEmail) methodEmail.innerText = '';
      // Reset new PIN steps/modal
      var resetStep = document.getElementById('sayaStepResetPIN');
      if (resetStep) { resetStep.classList.add('hidden'); resetStep.style.display = ''; resetStep.style.height = ''; }
      var offerModal = document.getElementById('sayaPINOfferModal');
      if (offerModal) offerModal.classList.add('hidden');
      _sayaOTPMode_ = 'login';
      var otpBoxes = document.querySelectorAll('#sayaStepOTP .otp-box');
      otpBoxes.forEach(function(b) { b.value = ''; b.classList.remove('filled'); });

      // 5. Navigate ke home
      switchPage('homePage');
      setActiveNavById('navHome');

      // 6. Reset greeting
      var nameEl = document.getElementById('homeUsername');
      var greetEl = document.getElementById('homeGreeting');
      if (nameEl) nameEl.innerText = 'Warga';
      if (greetEl) {
        var hour = new Date().getHours();
        var _g = _getGreetingHTML_(hour);
        var _greetHTML = _g.svg + _g.text;
        greetEl.innerHTML = _greetHTML;
        var tgEl = document.getElementById('desktopTopbarGreeting');
        if (tgEl) tgEl.innerHTML = _greetHTML;
      }

      // 7. Reset tunggakan card (currentUser sudah null, loadHomeTunggakan akan mask)
      loadHomeTunggakan();
      loadHomeFasum();
      loadHomeInfo();
      _updatePedomanHint_();
      if (typeof _renderSaldoKasCard_ === 'function') _renderSaldoKasCard_();

      // 8. Toast — delay agar switchPage selesai render dulu
      setTimeout(function() {
        showToast('Anda telah keluar', 'success');
      }, 150);
    }

    if (emailToLogout) {
      gasPost_('logoutUser', { email: emailToLogout })
        .then(function() { _doResetUI_(); })
        .catch(function() { _doResetUI_(); });
    } else {
      _doResetUI_();
    }
  }

  function openHome() {
    var homePage = document.getElementById('homePage');
    var alreadyActive = homePage && homePage.classList.contains('active');

    switchPage('homePage');
    history.pushState({ home: true }, '');
    setActiveNavById('navHome');
    loadHomeDataIfNeeded();

    // Jika sudah di home → scroll to top
    if (homePage) homePage.scrollTop = 0;
  }

  function cancelSayaEdit() {
    var namaEl  = document.getElementById('sayaNamaInput');
    var hpEl    = document.getElementById('sayaHpInput');
    var editBtn = document.getElementById('sayaEditBtn');
    var saveBtn = document.getElementById('sayaSaveBtn');
    var cancelBtn = document.getElementById('sayaCancelBtn');
    // Restore original values from data attributes
    if (namaEl) { namaEl.value = namaEl.dataset.original || namaEl.value; namaEl.readOnly = true; namaEl.style.borderBottom = ''; namaEl.style.paddingBottom = ''; }
    if (hpEl)   { hpEl.value  = hpEl.dataset.original  || hpEl.value;   hpEl.readOnly  = true; hpEl.style.borderBottom  = ''; hpEl.style.paddingBottom  = ''; }
    if (editBtn)   editBtn.classList.remove('hidden');
    if (saveBtn)   saveBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  function enableSayaEdit() {
    var namaEl  = document.getElementById('sayaNamaInput');
    var hpEl    = document.getElementById('sayaHpInput');
    var editBtn = document.getElementById('sayaEditBtn');
    var saveBtn = document.getElementById('sayaSaveBtn');
    var cancelBtn = document.getElementById('sayaCancelBtn');

    // Save originals for cancel
    if (namaEl) namaEl.dataset.original = namaEl.value;
    if (hpEl)   hpEl.dataset.original   = hpEl.value;

    // Hanya nama dan HP yang editable
    [namaEl, hpEl].forEach(function(el) {
      if (!el) return;
      el.readOnly = false;
      el.classList.remove('text-gray-900');
      el.classList.add('text-gray-900');
      // Visual: tambah underline border bawah sebagai edit indicator
      el.style.borderBottom = '1.5px solid #2563eb';
      el.style.paddingBottom = '2px';
    });

    if (editBtn)   editBtn.classList.add('hidden');
    if (saveBtn)   saveBtn.classList.remove('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    // Focus ke nama dulu
    if (namaEl) setTimeout(function(){ namaEl.focus(); namaEl.select(); }, 100);
  }

  function saveSayaData() {
    const namaEl  = document.getElementById('sayaNamaInput');
    const hpEl    = document.getElementById('sayaHpInput');
    const emailEl = document.getElementById('sayaEmailEditInput');
    const btn     = document.getElementById('sayaSaveBtn');

    const payload = {
      email: currentUser ? currentUser.email : '',
      nama: namaEl ? namaEl.value.trim() : '',
      noHp: hpEl ? hpEl.value.trim() : ''
    };

    // ===== LOADING STATE =====
    btn.disabled = true;
    btn.innerHTML = `
      <span class="flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"
            stroke="white" stroke-width="3"
            fill="none" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"
            stroke="white" stroke-width="3"
            fill="none"/>
        </svg>
        Menyimpan...
      </span>
    `;

    gasPost_('updateDataWargaFromSaya', { payload: payload })
      .then(function(res) {
        if (!res.success) {
          btn.disabled = false;
          btn.innerHTML = 'Simpan Perubahan';
          showToast('Gagal menyimpan data','error');
          return;
        }
        btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Berhasil</span>';
        setTimeout(function() {
          [namaEl, hpEl].forEach(function(el) {
            if (!el) return;
            el.readOnly = true;
            el.style.borderBottom = '';
            el.style.paddingBottom = '';
          });
          document.getElementById('sayaEditBtn')?.classList.remove('hidden');
          document.getElementById('sayaSaveBtn')?.classList.add('hidden');
          document.getElementById('sayaCancelBtn')?.classList.add('hidden');
          btn.disabled = false;
          btn.innerHTML = 'Simpan';
          showToast('Data berhasil diperbarui','success');
        }, 800);
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Simpan';
        showToast('Gagal menyimpan data','error');
      });
  }

  function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
  }

  function formatTanggalIndonesia(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);

    if (isNaN(date)) return '';

    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    };

    return date.toLocaleDateString('id-ID', options);
  }

  function renderList(list) {
    const loadingEl = document.getElementById('dashboardLoading');
    if (loadingEl) {
      loadingEl.classList.add('hidden');
      loadingEl.style.display = 'none';
    }

    const container = document.getElementById('dashboardList');
    container.innerHTML = '';

    if (!list.length) {
      container.innerHTML = `
        <div class="text-center text-gray-400 text-sm py-8">
          Tidak ada data pada tab ini.
        </div>
      `;
      return;
    }

    // Group by bulan+tahun
    list.forEach(function(item) {
        var isPending = (item.status || '').toLowerCase() === 'pending';

        // Hitung umur submission untuk follow-up button
        var showFollowUp = false;
        if (isPending && item.timestamp) {
          var ageMs = Date.now() - new Date(item.timestamp).getTime();
          var ageDays = ageMs / (1000 * 60 * 60 * 24);
          showFollowUp = ageDays >= 3;
        }

        var isAdmin = _dashIsAdmin_();
        var confirmedLabel = isAdmin ? 'Confirmed' : 'Lunas';

        var isRejected = (item.status || '').toLowerCase() === 'rejected';

        var statusBadge = isPending
          ? '<span class="px-2 py-0.5 text-[11px] rounded-full bg-yellow-100 text-yellow-700 font-semibold">Pending</span>'
          : isRejected
            ? '<span class="px-2 py-0.5 text-[11px] rounded-full bg-red-50 text-red-500 ring-1 ring-red-200 font-semibold">Ditolak</span>'
            : '<span class="px-2 py-0.5 text-[11px] rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200 font-semibold">' + confirmedLabel + '</span>';

        var nominalFmt = 'Rp ' + Number(item.nominal || 0).toLocaleString('id-ID');
        var tanggalFmt = item.tanggal ? formatTanggalIndonesia(item.tanggal) : '';

        var buktiBtn = '<button data-bukti="' + (item.bukti || '') + '"' +
          ' class="lihat-bukti-btn flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 px-3 py-2 rounded-xl bg-gray-100 active:scale-95 transition' +
          (!item.bukti ? ' opacity-40 cursor-not-allowed' : '') + '"' +
          (!item.bukti ? ' disabled' : '') + '>' +
          '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/>' +
          '<path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>' +
          '</svg>Bukti</button>';

        var isWarga = currentUser && currentUser.role !== 'admin';
        var reminderBtn = (showFollowUp && isWarga)
          ? '<button onclick="sendReminderToAdmin(' + item.rowNumber + ', this)"' +
            ' class="flex items-center justify-center gap-1.5 text-xs font-semibold text-orange-600 px-3 py-2 rounded-xl bg-orange-50 active:scale-95 transition">' +
            '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
            '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
            '</svg>Ingatkan Pengurus</button>'
          : '';

        var adminConfirmBtn = '';
        var adminWaBtn = '';
        var adminRejectBtn = '';

        if (isPending && _dashIsAdmin_()) {
          adminConfirmBtn =
            '<button onclick="confirmPaymentFromUI(' + item.rowNumber + ')"' +
            ' class="flex items-center justify-center gap-1.5 text-xs font-semibold text-white px-3 py-2 rounded-xl bg-primary active:scale-95 transition">Confirm</button>';

          adminRejectBtn =
            '<button onclick="rejectPaymentFromUI(' + item.rowNumber + ')"' +
            ' class="flex items-center justify-center gap-1.5 text-xs font-semibold text-red-600 px-3 py-2 rounded-xl bg-red-50 border border-red-200 active:scale-95 transition">Reject</button>';

          var noHp = String(item.noHp || '').replace(/\D/g, '');
          if (noHp.startsWith('0')) noHp = '62' + noHp.slice(1);

          if (noHp) {
            var adminName = (currentUser && currentUser.fullName) ? currentUser.fullName : 'Admin';
            var wargaNama = item.nama || 'Warga';
            var periode   = (item.bulan || '') + ' ' + (item.tahun || '');
            var nominalFmtWa = 'Rp ' + Number(item.nominal || 0).toLocaleString('id-ID');

            var waMsg = 'Halo ' + wargaNama + ',\n\n' +
              'Saya *' + adminName + '* dari Pengurus Paguyuban Jade Park Serpong 2.\n\n' +
              'Kami menerima konfirmasi pembayaran IPL Anda:\n' +
              '- Periode: *' + periode + '*\n' +
              '- Nominal: *' + nominalFmtWa + '*\n\n' +
              'Mohon konfirmasi apakah data di atas sudah sesuai ya';

            var waUrl = 'https://wa.me/' + noHp + '?text=' + encodeURIComponent(waMsg);

            adminWaBtn =
              '<a href="' + waUrl + '" target="_blank"' +
              ' class="flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-700 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 active:scale-95 transition">' +
              '<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
              '</svg>WA</a>';
          }
        }

        var isConfirmed = (item.status || '').toLowerCase() === 'confirmed';
        var verifiedBySection = '';
        if (isConfirmed && !isAdmin && item.verifiedBy) {
          // tidak tampil di sisi warga
        } else if (isConfirmed && isAdmin && item.verifiedBy) {
          verifiedBySection =
            '<div class="mt-1 flex items-center gap-1">' +
              '<svg class="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '<span class="text-[10px] text-gray-400">Confirmed by <span class="font-medium text-gray-500">' + (item.verifiedBy ? item.verifiedBy.split('@')[0] : '') + '</span></span>' +
            '</div>';
        }

        var uidSection = !isPending
          ? '<div id="uid-container-' + item.rowNumber + '" class="mt-1">' +
            renderUidTableCompact(item) +
            '</div>'
          : '';

        var card = document.createElement('div');
        card.className = 'bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 animate-fadeIn';

        card.innerHTML =
          // ROW 1: Blok · Nama + Status
          '<div class="flex items-center justify-between gap-2">' +
            '<div class="flex items-center gap-1.5 min-w-0">' +
              '<span class="text-sm font-bold text-gray-900 flex-shrink-0">' +
                [item.blok, item.blok2].filter(Boolean).join(', ') +
              '</span>' +
              '<span class="text-gray-200">·</span>' +
              '<span class="text-xs text-gray-500 truncate">' + (item.nama || '') + '</span>' +
            '</div>' +
            statusBadge +
          '</div>' +

          // ROW 2: Periode + tanggal bayar (kiri) · Nominal (kanan)
          '<div class="mt-1.5 flex items-end justify-between gap-2">' +
            '<div class="flex items-center gap-1.5 min-w-0">' +
              '<svg class="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
              '<span class="text-[11px] text-gray-400 truncate">' + (item.bulan || '') + ' ' + (item.tahun || '') +
                (tanggalFmt ? ' &middot; dibayar ' + tanggalFmt : '') + '</span>' +
            '</div>' +
            '<span class="text-base font-bold text-gray-900 flex-shrink-0">' + nominalFmt + '</span>' +
          '</div>' +

          // ROW 5: Keterangan warga
          (item.keterangan ?
          '<div class="mt-1.5 flex items-start gap-1.5 bg-amber-50 rounded-xl px-2.5 py-1.5">' +
            '<svg class="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<span class="text-[11px] text-amber-700 italic">' + item.keterangan + '</span>' +
          '</div>' : '') +

          // ROW 6: Alasan reject (hanya jika rejected)
          (isRejected && item.rejectNote ?
          '<div class="mt-1.5 flex items-start gap-1.5 bg-red-50 rounded-xl px-2.5 py-1.5">' +
            '<svg class="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
            '<span class="text-[11px] text-red-600 font-medium">Alasan: ' + item.rejectNote + '</span>' +
          '</div>' : '') +

          // UID section
          (uidSection ? '<div class="mt-2 pt-2 border-t border-gray-50">' + uidSection + '</div>' : '') +
          verifiedBySection +

          // ACTION BUTTONS
          '<div class="grid grid-cols-2 gap-2 mt-2.5 pt-2 border-t border-gray-50">' +
            buktiBtn +
            reminderBtn +
            adminWaBtn +
            adminConfirmBtn +
            adminRejectBtn +
          '</div>';

        container.appendChild(card);
    });
  }

  function sendReminderToAdmin(rowNumber, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/>' +
        '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none"/>' +
        '</svg>';
    }

    var item = dashboardPendingCache.find(function(d) {
      return d.rowNumber === rowNumber;
    });
    if (!item) return;

    var payload = {
      rowNumber: rowNumber,
      nama: item.nama || '',
      blok: item.blok || '',
      bulan: item.bulan || '',
      tahun: item.tahun || '',
      nominal: item.nominal || 0,
      senderEmail: currentUser ? currentUser.email : ''
    };

    gasPost_('sendPaymentReminder', { payload: payload })
      .then(function() {
        if (btnEl) {
          btnEl.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
          btnEl.className = 'flex items-center gap-1.5 text-xs font-semibold text-blue-600 px-3 py-1.5 rounded-xl bg-blue-50 transition';
        }
        showToast('Admin sudah diingatkan', 'success');
      })
      .catch(function() {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = 'Ingatkan Admin';
        }
        showToast('Gagal mengirim reminder', 'error');
      });
  }

  function renderUidTable(item) {
    if (uidLoadedRows.has(item.rowNumber) && item.uidList) {
      return buildUidHTML(item);
    }
    if (!item._uidLoading) {
      item._uidLoading = true;
      gasGet_('getUIDForRow', { rowNumber: item.rowNumber })
        .then(function(uidList) {
          item.uidList = uidList || [];
          uidLoadedRows.add(item.rowNumber);
          item._uidLoading = false;
          var container = document.getElementById('uid-container-' + item.rowNumber);
          if (container) { container.innerHTML = buildUidHTML(item); }
        })
        .catch(function() { item._uidLoading = false; });
    }
    return '<div class="text-sm text-gray-400 italic py-2">Memuat ID pembayaran...</div>';
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.lihat-bukti-btn');
    if (!btn) return;

    if (btn.disabled) return;

    const url = btn.dataset.bukti;
    if (!url) return;

    openBuktiViewer(url);
  });

  function renderUidTableCompact(item) {

    if (uidLoadedRows.has(item.rowNumber) && item.uidList) {
      return buildUidCompactHTML(item);
    }

    if (!item._uidLoading) {
      item._uidLoading = true;

      gasGet_('getUIDForRow', { rowNumber: item.rowNumber })
        .then(function(uidList) {
          item.uidList = uidList || [];
          uidLoadedRows.add(item.rowNumber);
          item._uidLoading = false;
          var container = document.getElementById('uid-container-' + item.rowNumber);
          if (container) { container.innerHTML = buildUidCompactHTML(item); }
        })
        .catch(function() { item._uidLoading = false; });
    }

    return '<div class="text-[11px] text-gray-300 italic">Memuat ID...</div>';
  }

  function buildUidCompactHTML(item) {
    var verifiedFmt = item.verifiedAt ? formatTanggalIndonesia(item.verifiedAt) : '';
    var verifiedRow = verifiedFmt
      ? '<div class="text-[11px] text-gray-400 mb-1">Dikonfirmasi ' + verifiedFmt + '</div>'
      : '';

    var html = verifiedRow + '<div class="flex flex-col gap-0.5">';

    // Format baru: uidList = [{bulan, blok, uid}, ...]
    var isNewFormat = item.uidList && item.uidList.length > 0 && typeof item.uidList[0] === 'object';

    if (isNewFormat) {
      item.uidList.forEach(function(entry) {
        var label = entry.bulan + ' ' + (item.tahun || '') + (entry.blok ? ' (' + entry.blok + ')' : '');
        var uid = entry.uid || '-';
        html +=
          '<div class="flex items-center justify-between">' +
            '<span class="text-[11px] text-gray-400">' + label + '</span>' +
            '<span class="text-[11px] font-mono text-gray-500 tracking-tight cursor-pointer active:opacity-60"' +
              ' onclick="copyToClipboard(this.dataset.uid)" data-uid="' + uid + '">' + uid +
              '<svg class="w-2.5 h-2.5 inline ml-1 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
              '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
              '</svg>' +
            '</span>' +
          '</div>';
      });
    } else {
      // Format lama: uidList = ['uid1', 'uid2']
      var bulanArray = (item.bulan || '').toString().split(',').map(function(b) { return b.trim(); });
      bulanArray.forEach(function(bulan, index) {
        var uid = (item.uidList && item.uidList[index]) ? item.uidList[index] : '-';
        html +=
          '<div class="flex items-center justify-between">' +
            '<span class="text-[11px] text-gray-400">' + bulan + ' ' + (item.tahun || '') + '</span>' +
            '<span class="text-[11px] font-mono text-gray-500 tracking-tight cursor-pointer active:opacity-60"' +
              ' onclick="copyToClipboard(this.dataset.uid)" data-uid="' + uid + '">' + uid +
              '<svg class="w-2.5 h-2.5 inline ml-1 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
              '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
              '</svg>' +
            '</span>' +
          '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function applySearchAndRender(sourceData) {

    var searchEl = document.getElementById('dashboardSearch');
    var keyword = searchEl ? searchEl.value.toLowerCase().trim() : '';

    if (!keyword) {
      renderList(sourceData);
      return;
    }

    const filtered = sourceData.filter(item => {

      const searchTarget = [
        item.nama,
        item.blok,
        item.bulan,
        item.tahun,
        item.uidList ? item.uidList.join(' ') : ''
      ]
        .join(' ')
        .toLowerCase();

      return searchTarget.includes(keyword);
    });

    renderList(filtered);
  }

  function applyFilters() {
    if (!currentUser) {
      closeDashboard();
      openLoginModal();
      return;
    }

    // 🔥 hitung ulang total tab sesuai filter
    const filteredPending = getFilteredDataForTab('pending');
    const filteredConfirmed = getFilteredDataForTab('confirmed');
    const pendingTab = document.getElementById('pendingTabCount');
    const confirmedTab = document.getElementById('confirmedTabCount');

    if (pendingTab) {
      pendingTab.innerText = filteredPending.length;
    }

    if (confirmedTab) {
      confirmedTab.innerText = filteredConfirmed.length;
    }

    // Warga: render sesuai scorecard filter
    var isAdmin = _dashIsAdmin_();
    if (!isAdmin) {
      var allWarga = getFilteredDataForTab('all_warga');
      var listToRender = allWarga;
      if (wargaScoreFilter === 'pending') {
        listToRender = allWarga.filter(function(i) { return i.status === 'pending'; });
      } else if (wargaScoreFilter === 'confirmed') {
        listToRender = allWarga.filter(function(i) { return i.status === 'confirmed'; });
      }
      renderList(listToRender);
      return;
    }

    // Admin: render sesuai tab aktif
    var activeData =
      activeTabType === 'pending'
        ? filteredPending
        : filteredConfirmed;
    renderList(activeData);
  }

  function getFilteredDataForTab(type) {
    var isAdmin = _dashIsAdmin_();

    // Warga: gabung semua data termasuk rejected, sorted terbaru dulu
    // Warga: gabung semua data termasuk rejected, sorted terbaru dulu
    if (!isAdmin) {
      var rejectedCache = dashboardCache && dashboardCache.rejected ? dashboardCache.rejected : [];
      var allData = dashboardPendingCache.concat(dashboardConfirmedCache).concat(rejectedCache);
      allData.sort(function(a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

      var userEmail = currentUser.email ? currentUser.email.trim().toLowerCase() : '';

      // Ambil daftar blok milik user dari wargaData
      var userOwnBlocks = [];
      if (Array.isArray(currentUser.wargaData) && currentUser.wargaData.length) {
        userOwnBlocks = currentUser.wargaData.map(function(d) {
          return String(d.blok || '').trim().toUpperCase();
        });
      } else if (Array.isArray(currentUser.blocks) && currentUser.blocks.length) {
        userOwnBlocks = currentUser.blocks.map(function(b) {
          return String(b).trim().toUpperCase();
        });
      }

      // Filter STRICT: email match DAN blok milik user
      var filtered = allData.filter(function(item) {
        var emailMatch = userEmail && item.email && item.email === userEmail;

        // Cek blok 1 DAN blok 2 — support multi-home
        var itemBlok1 = String(item.blok  || '').trim().toUpperCase();
        var itemBlok2 = String(item.blok2 || '').trim().toUpperCase();
        var blokMatch = userOwnBlocks.length > 0 && (
          userOwnBlocks.includes(itemBlok1) ||
          (itemBlok2 && userOwnBlocks.includes(itemBlok2))
        );

        return emailMatch && blokMatch;
      });

      // Search
      var kwWarga = (document.getElementById('dashboardSearch') ? document.getElementById('dashboardSearch').value : '').toLowerCase().trim();
      if (kwWarga) {
        filtered = filtered.filter(function(item) {
          return [item.nama, item.blok, item.bulan, item.tahun]
            .join(' ').toLowerCase().indexOf(kwWarga) !== -1;
        });
      }

      return filtered;
    }

    var source =
      type === 'pending'
        ? dashboardPendingCache
        : dashboardConfirmedCache;
    var filtered = [...source];

    // Sort terbaru di atas
    filtered.sort(function(a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    // ===== ROLE FILTER =====
    if (currentUser && currentUser.role === 'warga') {
      const userBlocks = Array.isArray(currentUser.blocks)
        ? currentUser.blocks.map(b => String(b).toUpperCase())
        : [];

      filtered = filtered.filter(item =>
        userBlocks.includes(
          String(item.blok || '').toUpperCase()
        )
      );
    }
    // ===== SEARCH =====
    const keyword =
      (document.getElementById('dashboardSearch')?.value || '')
        .toLowerCase().trim();

    if (keyword) {
      filtered = filtered.filter(item => {
        const searchTarget = [
          item.nama,
          item.blok,
          item.bulan,
          item.tahun,
          item.uidList ? item.uidList.join(' ') : ''
        ].join(' ').toLowerCase();

        return searchTarget.includes(keyword);
      });
    }
    // ===== FILTER BULAN =====
    var monthFilterEl2 = document.getElementById('monthFilterSelect');
    var selectedMonth  = monthFilterEl2 ? monthFilterEl2.value : '';
    if (selectedMonth) {
      filtered = filtered.filter(function(item) {
        var bulanStr = String(item.bulan || '').trim();
        // bulan bisa "Apr", "Jan, Feb, Mar" — cek apakah selectedMonth ada di dalamnya
        var parts = bulanStr.split(',').map(function(b) { return b.trim(); });
        return parts.some(function(p) {
          return p.toLowerCase() === selectedMonth.toLowerCase();
        });
      });
    }

    // ===== TIME FILTER =====
    if (activeTimeFilter && activeTimeFilter !== 'all') {
      const now = new Date();
      filtered = filtered.filter(item => {
        if (!item.timestamp) return false;
        const d = new Date(item.timestamp);
        if (activeTimeFilter === 'today') {
          return d.toDateString() === now.toDateString();
        }

        if (activeTimeFilter === 'yesterday') {
          const y = new Date();
          y.setDate(now.getDate() - 1);
          return d.toDateString() === y.toDateString();
        }

        if (activeTimeFilter === 'this week') {
          const firstDay = new Date(now);
          firstDay.setDate(now.getDate() - now.getDay());
          firstDay.setHours(0,0,0,0);
          return d >= firstDay;
        }

        if (activeTimeFilter === 'this month') {
          return (
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
          );
        }
        return true;
      });
    }
    // ===== CUSTOM RANGE =====
    if (customDateRange) {
      filtered = filtered.filter(item => {
        if (!item.timestamp) return false;
        const d = new Date(item.timestamp);
        const start = new Date(customDateRange.start);
        const end   = new Date(customDateRange.end);
        end.setHours(23,59,59,999);
        return d >= start && d <= end;
      });
    }
    // ===== RATE FILTER =====
    if (activeRateFilter) {
      filtered = filtered.filter(
        item => Number(item.nominal) === activeRateFilter
      );
    }
    return filtered;
  }

  function confirmPaymentFromUI(rowNumber) {
    if (!currentUser || currentUser.role !== 'admin') {
      showToast('Unauthorized','error');
      return;
    }

    const modal = document.getElementById('confirmModal');
    const text = modal.querySelector('p');

    text.innerText = 'Konfirmasi pembayaran ini?';
    modal.classList.remove('hidden');

    const yesBtn = modal.querySelector('button:last-child');
    const noBtn = modal.querySelector('button:first-child');

    // RESET
    yesBtn.onclick = null;
    noBtn.onclick = null;
    yesBtn.disabled = false;
    noBtn.disabled = false;
    yesBtn.innerHTML = 'Ya';

    yesBtn.onclick = function () {

      yesBtn.disabled = true;
      noBtn.disabled = true;

      yesBtn.innerHTML = `
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"
              stroke="currentColor" stroke-width="3"
              fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor" stroke-width="3"
              fill="none"/>
          </svg>
          Memproses...
        </span>
      `;

      gasPost_('confirmPayment', {
          rowNumber: rowNumber,
          adminEmail: currentUser.email,
          note: 'Confirmed via Dashboard'
        })
          .then(function(res) {
            try {
              modal.classList.add('hidden');
              var confirmedItem = null;
              for (var i = 0; i < dashboardPendingCache.length; i++) {
                if (dashboardPendingCache[i].rowNumber === rowNumber) {
                  confirmedItem = dashboardPendingCache[i];
                  break;
                }
              }
              dashboardPendingCache = dashboardPendingCache.filter(function(d) {
                return d.rowNumber !== rowNumber;
              });
              if (confirmedItem) {
                confirmedItem.status = 'Confirmed';
                confirmedItem.uidList = null;
                confirmedItem.uidGenerating = true;
                dashboardConfirmedCache.unshift(confirmedItem);
              }
              yesBtn.disabled = false;
              noBtn.disabled = false;
              yesBtn.innerHTML = 'Ya';
              try { sessionStorage.removeItem('dashCache'); } catch(e) {}
              applyFilters();
              updateDashboardScorecards();
              showToast('Pembayaran berhasil dikonfirmasi', 'success');
            } catch(e) {
              console.error('confirmPayment UI error:', e);
              modal.classList.add('hidden');
              yesBtn.disabled = false;
              noBtn.disabled = false;
              yesBtn.innerHTML = 'Ya';
              showToast('Pembayaran diproses, refresh untuk lihat perubahan', 'success');
            }
          })
          .catch(function(err) {
            console.error('confirmPayment server error:', err);
            yesBtn.disabled = false;
            noBtn.disabled = false;
            yesBtn.innerHTML = 'Ya';
            modal.classList.add('hidden');
            showToast('Gagal mengonfirmasi pembayaran', 'error');
          });
    };

    noBtn.onclick = function () {
      modal.classList.add('hidden');
    };
  }

  function rejectPayment(rowNumber, adminEmail) {
    let session = getCurrentUserSession(adminEmail);
    if (!session) session = forceRefreshSession_(adminEmail);
    if (!session || session.role !== 'admin') {
      return { success: false, message: 'Unauthorized' };
    }

    const sh = SpreadsheetApp
      .openById(SS_ID)
      .getSheetByName(SHEET_NAME);
    if (!sh) return { success: false, message: 'Sheet tidak ditemukan' };

    sh.getRange(rowNumber, 18).setValue('Rejected');
    sh.getRange(rowNumber, 19).setValue(adminEmail);
    sh.getRange(rowNumber, 20).setValue(new Date());

    CacheService.getScriptCache().remove('dashboard_data_light');

    return { success: true };
  }

  function rejectPaymentFromUI(rowNumber) {
    if (!currentUser || currentUser.role !== 'admin') {
      showToast('Unauthorized', 'error');
      return;
    }

    // Buka reject modal khusus
    var modal = document.getElementById('rejectModal');
    var input = document.getElementById('rejectReasonInput');
    var yesBtn = document.getElementById('rejectConfirmBtn');
    var noBtn = document.getElementById('rejectCancelBtn');
    var errorEl = document.getElementById('rejectReasonError');

    if (!modal) return;

    // Reset state
    input.value = '';
    errorEl.classList.add('hidden');
    yesBtn.disabled = true;
    yesBtn.innerHTML = 'Ya, Reject';
    modal.classList.remove('hidden');
    setTimeout(function() { input.focus(); }, 100);

    // Enable button hanya jika ada isian
    input.oninput = function() {
      var hasVal = input.value.trim().length > 0;
      yesBtn.disabled = !hasVal;
      if (hasVal) errorEl.classList.add('hidden');
    };

    yesBtn.onclick = function() {
      var alasan = input.value.trim();
      if (!alasan) {
        errorEl.classList.remove('hidden');
        input.focus();
        return;
      }

      yesBtn.disabled = true;
      noBtn.disabled = true;
      yesBtn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
        '<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/>' +
        '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none"/>' +
        '</svg>Memproses...</span>';

      gasPost_('rejectPayment', {
        rowNumber: rowNumber,
        adminEmail: currentUser.email,
        alasan: alasan
      })
        .then(function(res) {
          modal.classList.add('hidden');
          noBtn.disabled = false;
          if (!res || !res.success) {
            showToast(res && res.message ? res.message : 'Gagal reject', 'error');
            return;
          }
          dashboardPendingCache = dashboardPendingCache.filter(function(d) {
            return d.rowNumber !== rowNumber;
          });
          try { sessionStorage.removeItem('dashCache'); } catch(e) {}
          applyFilters();
          updateDashboardScorecards();
          showToast('Pembayaran di-reject', 'success');
        })
        .catch(function() {
          modal.classList.add('hidden');
          yesBtn.disabled = false;
          noBtn.disabled = false;
          yesBtn.innerHTML = 'Ya, Reject';
          showToast('Gagal reject pembayaran', 'error');
        });
    };

    noBtn.onclick = function() {
      modal.classList.add('hidden');
    };
  }

  function switchTab(type) {
    activeTabType = type;

    var pendingBtn    = document.getElementById('tabPending');
    var confirmedBtn  = document.getElementById('tabConfirmed');
    var wargaBaruBtn  = document.getElementById('tabWargaBaru');

    var dashList      = document.getElementById('dashboardList');
    var wargaContent  = document.getElementById('wargaBaruContent');
    var filterRow     = document.getElementById('dashboardFilterRow');
    var searchBar     = document.querySelector('#dashboardSearch')?.closest('.relative');

    var inactiveClass = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 border border-gray-200 active:scale-95 transition tab-pill';

    if (pendingBtn)   pendingBtn.className   = inactiveClass;
    if (confirmedBtn) confirmedBtn.className = inactiveClass;
    if (wargaBaruBtn) wargaBaruBtn.className = inactiveClass;

    if (type === 'wargaBaru') {
      if (wargaBaruBtn) wargaBaruBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200 active:scale-95 transition tab-pill active';
      if (dashList)    dashList.classList.add('hidden');
      if (wargaContent) wargaContent.classList.remove('hidden');
      if (filterRow)   filterRow.classList.add('hidden');
      if (searchBar)   searchBar.classList.add('hidden');
      loadWargaBaru();
      return;
    }

    // Restore IPL tabs view
    if (dashList)    dashList.classList.remove('hidden');
    if (wargaContent) wargaContent.classList.add('hidden');
    if (filterRow)   filterRow.classList.remove('hidden');
    if (searchBar)   searchBar.classList.remove('hidden');

    if (type === 'pending') {
      if (pendingBtn) pendingBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200 active:scale-95 transition tab-pill active';
    } else {
      if (confirmedBtn) confirmedBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200 active:scale-95 transition tab-pill active';
    }

    applyFilters();
    _updateScorecardActive_(type);
  }

  // Scorecard sebagai filter (pengganti tab Pending/Confirmed) — admin verifikasi only
  function dashScorecardFilter(type) {
    if (!_dashIsAdmin_()) return;
    switchTab(type);
  }

  // Highlight scorecard yang sedang aktif jadi filter
  function _updateScorecardActive_(type) {
    var p = document.getElementById('scPendingCard');
    var c = document.getElementById('scConfirmedCard');
    if (p) {
      p.style.boxShadow = (type === 'pending')   ? '0 0 0 2px #F59E0B' : 'none';
      p.style.opacity   = (type === 'confirmed') ? '0.6' : '1';
    }
    if (c) {
      c.style.boxShadow = (type === 'confirmed') ? '0 0 0 2px #3b82f6' : 'none';
      c.style.opacity   = (type === 'pending')   ? '0.6' : '1';
    }
  }

  function openBuktiViewer(url) {

    if (!url) return;

    var viewer = document.getElementById('buktiViewer');
    var img = document.getElementById('buktiImage');
    var pdfContainer = document.getElementById('buktiPdfContainer');

    img.classList.add('hidden');
    img.src = '';
    pdfContainer.classList.add('hidden');
    pdfContainer.innerHTML = '';

    var match = url.match(/\/d\/(.*?)\//);
    var fileId = match ? match[1] : null;

    if (!fileId) return;

    var previewUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';

    // IMAGE
    if (url.match(/\.(jpeg|jpg|png|webp)$/i)) {

      img.src = previewUrl;
      img.classList.remove('hidden');

    } else {

      var iframe = document.createElement('iframe');
      iframe.src = previewUrl;
      iframe.className = 'w-full h-[75vh] rounded-xl';
      iframe.allow = 'autoplay';

      pdfContainer.appendChild(iframe);
      pdfContainer.classList.remove('hidden');
    }

    viewer.classList.remove('hidden');
  }

  function closeBuktiViewer() {

    const viewer = document.getElementById('buktiViewer');
    const img = document.getElementById('buktiImage');
    const pdfContainer = document.getElementById('buktiPdfContainer');

    img.src = '';
    pdfContainer.innerHTML = '';
    viewer.classList.add('hidden');
  }

  /* ======================================
    SWIPE RIGHT = BACK (STABLE VERSION)
    Applies to: #sheet & #dashboard
  ====================================== */
  (function () {

    const SWIPE_THRESHOLD = 80; // jarak minimal swipe
    const EDGE_LIMIT = 40;      // hanya aktif dari tepi kiri

    function enableSwipeRightBack(container, onBack) {

      if (!container) return;

      let startX = 0;
      let startY = 0;
      let tracking = false;

      container.addEventListener('touchstart', function (e) {

        const t = e.touches[0];

        // hanya aktif jika swipe dimulai dari kiri layar
        if (t.clientX > EDGE_LIMIT) return;

        startX = t.clientX;
        startY = t.clientY;
        tracking = true;

      }, { passive: true });

      container.addEventListener('touchmove', function (e) {

        if (!tracking) return;

        const t = e.touches[0];

        const deltaX = t.clientX - startX;
        const deltaY = t.clientY - startY;

        // dominan horizontal & swipe ke kanan
        if (
          deltaX > SWIPE_THRESHOLD &&
          Math.abs(deltaY) < 70
        ) {
          tracking = false;
          onBack();
        }

      }, { passive: true });

      container.addEventListener('touchend', function () {
        tracking = false;
      });

    }

    document.addEventListener('DOMContentLoaded', function () {

      enableSwipeRightBack(
        document.getElementById('sheet'),
        function () { closeSheet(); }
      );

      enableSwipeRightBack(
        document.getElementById('dashboard'),
        function () { closeDashboard(); }
      );

    });

  })();

  /* ======================================
    ANDROID BACK BUTTON / GESTURE SUPPORT
  ====================================== */
  window.addEventListener('popstate', function (event) {

    // Kalau sheet terbuka → tutup sheet
    if (document.body.classList.contains('ipl-form-open')) {
      closeSheet();
      return;
    }

    const sayaEl = document.getElementById('pageSaya');
    if (sayaEl && !sayaEl.classList.contains('hidden')) {
      // Di sub-step login (PIN/OTP/reset)? Back → mundur ke step email dulu,
      // bukan langsung tutup halaman (hierarki back yg dapat ditebak).
      var onSubStep = !currentUser && ['sayaStepMethod','sayaStepOTP','sayaStepResetPIN'].some(function(id) {
        var el = document.getElementById(id);
        return el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
      });
      if (onSubStep) {
        backToEmailStep();
        history.pushState({ saya: true }, ''); // jaga buffer agar back berikutnya tetap jalan
        return;
      }
      closePageSaya();
      return;
    }

    var pdfPrev = document.getElementById('kasPdfPreviewOverlay');
    if (pdfPrev && !pdfPrev.classList.contains('hidden')) {
      _kasClosePdfPreview_(); return;
    }

    var formChooser = document.getElementById('formChooserModal');
    if (formChooser && !formChooser.classList.contains('hidden')) {
      closeFormChooser(); return;
    }

    // Jualan: tutup form/detail dulu, lalu halaman
    var jualanForm = document.getElementById('jualanFormSheet');
    if (jualanForm && !jualanForm.classList.contains('hidden')) {
      closeJualanForm(); history.pushState({ jualan: true }, ''); return;
    }
    var jualanDetail = document.getElementById('jualanDetailModal');
    if (jualanDetail && !jualanDetail.classList.contains('hidden')) {
      closeJualanDetail(); history.pushState({ jualan: true }, ''); return;
    }
    var jualanEl = document.getElementById('jualanPage');
    if (jualanEl && !jualanEl.classList.contains('hidden')) {
      openHome();
      return;
    }

    var mudikEl = document.getElementById('formMudik');
    if (mudikEl && mudikEl.style.opacity === '1') {
      closeFormMudik();
      return;
    }

    var renovEl = document.getElementById('formRenovasi');
    if (renovEl && renovEl.style.opacity === '1') {
      closeFormRenovasi();
      return;
    }

    // Kalau dashboard terbuka → tutup dashboard
    var pedomanEl = document.getElementById('pedomanViewer');
    if (pedomanEl && !pedomanEl.classList.contains('hidden')) {
      closePedomanViewer();
      return;
    }

    // Kalau dashboard terbuka → tutup dashboard
    const dashboardEl = document.getElementById('dashboard');
    if (dashboardEl && !dashboardEl.classList.contains('hidden')) {
      closeDashboard();
      return;
    }
  });

document.addEventListener('click', function (e) {
  const btn = document.getElementById('headerAuthBtn');
  const dropdown = document.getElementById('headerDropdown');

  if (!btn || !dropdown) return;

  if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

/* ================= FEEDBACK SYSTEM ================= */

let selectedRating = 0;

function openFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  modal.classList.remove('hidden');
  renderStars();
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  modal.classList.add('hidden');
  selectedRating = 0;
  document.getElementById('feedbackRemark').value = '';
}

function renderStars() {
  const container = document.getElementById('starContainer');
  container.innerHTML = '';

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.innerHTML = '★';
    star.className = 'text-3xl cursor-pointer transition';

    star.style.color = i <= selectedRating ? '#2563eb' : '#d1d5db';

    star.onclick = () => {
      selectedRating = i;
      renderStars();
    };

    container.appendChild(star);
  }
}

function submitFeedback() {

  if (!selectedRating) {
    showToast('Silakan pilih rating terlebih dahulu', 'warning');
    return;
  }

  if (!currentUser || !currentUser.email) {
    showToast('Session tidak ditemukan', 'error');
    return;
  }

  const btn = document.getElementById('feedbackSubmitBtn');
  const spinner = document.getElementById('feedbackSpinner');
  const text = document.getElementById('feedbackBtnText');

  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  if (text) text.textContent = 'Mengirim...';

  const remark = document.getElementById('feedbackRemark').value;

  // ⏱️ minimum loading 600ms (biar smooth)
  const startTime = Date.now();

  gasPost_('saveWargaFeedback', { payload: { email: currentUser.email, rate: selectedRating, remark: remark } })
    .then(function(res) {
      var elapsed = Date.now() - startTime;
      var delay = Math.max(600 - elapsed, 0);
      setTimeout(function() {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (text) text.textContent = 'Kirim';
        if (res && res.success) {
          closeFeedbackModal();
          showToast('Terima kasih atas feedback Anda','success');
        } else {
          showToast('Gagal menyimpan feedback', 'error');
        }
      }, delay);
    })
    .catch(function() {
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (text) text.textContent = 'Kirim';
      showToast('Terjadi kesalahan sistem', 'error');
    });
}

function switchPage(targetId){

  // Auto-tutup form IPL (Bayar/Form) saat pindah menu lewat navbar.
  // Form pakai overlay #sheet via class 'ipl-form-open', bukan sistem page ini,
  // jadi tanpa ini overlay tetap nutupin layar walau halaman di belakang sudah ganti.
  if (document.body.classList.contains('ipl-form-open')) {
    document.body.classList.remove('ipl-form-open');
    var _ov = document.getElementById('overlay');
    if (_ov) _ov.classList.add('hidden');
    var _pk = document.getElementById('adminBayarPicker');
    if (_pk) _pk.classList.add('hidden');
    document.body.style.overflow = '';
  }

  const pages = [
    'homePage',
    'dashboard',
    'pageSaya',
    'laporPage',
    'suratPengantarPage',
    'jualanPage',
    'jadwalJagaPage',
    'votingPage',
    'explorePage'
  ];

  pages.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;

    if(id === targetId){
      el.classList.remove('hidden');
      el.classList.add('active');
    }else{
      el.classList.remove('active');
      el.classList.add('hidden');

    }

  });
}

function updateHomeGreeting() {
  const greetEl = document.getElementById('homeGreeting');
  const nameEl  = document.getElementById('homeUsername');
  if (!greetEl || !nameEl) return;

  const hour = new Date().getHours();
  const g = _getGreetingHTML_(hour);
  const greetHTML = g.svg + g.text;

  greetEl.innerHTML = greetHTML;

  // Sync to desktop topbar — with SVG icon
  var tg = document.getElementById('desktopTopbarGreeting');
  if (tg) tg.innerHTML = greetHTML;

  if (currentUser && currentUser.fullName) {
    var displayName = currentUser.fullName;
    var isAdmin = currentUser.role === 'admin';

    if (isAdmin) {
      nameEl.innerHTML = '<span style="background:linear-gradient(90deg,#B8860B,#FFD700,#B8860B);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">' +
        displayName +
        '</span>' +
        '<span style="font-size:11px;font-weight:600;color:#B8860B;background:#FFF8DC;border:1px solid #FFD700;border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:middle">Admin</span>';
    } else {
      nameEl.innerText = displayName;
    }
  } else if (currentUser && currentUser.email) {
    nameEl.innerText = currentUser.email.split('@')[0];
  } else {
    nameEl.innerText = 'Warga';
  }
}

// ============================================================
// HOME PAGE FUNCTIONS
// ============================================================

var homeDataCache = { fasum: null, info: null, tunggakan: null, contact: null, security: null };

function loadHomeData() {
  updateHomeGreeting();
  loadHeaderGreeting();
  loadHomeTunggakan();
  loadHomeFasum();
  loadHomeInfo();
  _updatePedomanHint_();
  preloadContactData();
  preloadSecurityContacts();
  if (typeof _renderSaldoKasCard_ === 'function') _renderSaldoKasCard_();
  if (typeof _renderKasTransparansi_ === 'function') _renderKasTransparansi_();
  if (typeof _checkVotingBanner_ === 'function') _checkVotingBanner_();
}

function _updatePedomanHint_() {
  var hint = document.getElementById('pedomanLoginHint');
  if (!hint) return;
  if (!currentUser) {
    hint.classList.remove('hidden');
    hint.classList.add('flex');
  } else {
    hint.classList.add('hidden');
    hint.classList.remove('flex');
  }
}

function loadHomeDataIfNeeded() {
    updateHomeGreeting();
    if (!homeDataCache.greeting) {
      loadHeaderGreeting();
    } else {
      startGreetingBanner_(homeDataCache.greeting); // items array
    }
    if (!homeDataCache.tunggakan) loadHomeTunggakan();
    if (!homeDataCache.fasum) loadHomeFasum();
    if (!homeDataCache.info) loadHomeInfo();
    if (!homeDataCache.contact) preloadContactData();
    if (!homeDataCache.security) preloadSecurityContacts();
    _updatePedomanHint_();
    if (typeof _renderSaldoKasCard_ === 'function') _renderSaldoKasCard_();
    if (typeof _renderKasTransparansi_ === 'function') _renderKasTransparansi_();
    if (typeof _checkVotingBanner_ === 'function') _checkVotingBanner_();
  }

/* ── Voting kontekstual: banner #votingBanner di home tampil hanya bila warga
   login & ada poll "Aktif" yg masih punya blok belum vote. Menggantikan tile
   Voting tetap (yang dulu sering "terkubur" di Lihat Semua). Admin tetap bisa
   matikan lewat toggle Shortcut Voting (votingEnabled). ── */
function _checkVotingBanner_() {
  var wrap = document.getElementById('votingBanner');
  if (!wrap) return;
  var hide = function() { wrap.classList.add('hidden'); };
  // Banner tampil utk SEMUA (termasuk guest) selama ada poll aktif; guest yg
  // klik akan diminta login (lihat _openVotingFromBanner_). Admin bisa matikan
  // lewat toggle Shortcut Voting (votingEnabled).
  if (typeof _featureFlags_ !== 'undefined' && _featureFlags_.votingEnabled === false) return hide();

  var loggedIn = !!(currentUser && currentUser.email);
  gasGet_('getPolls', { email: loggedIn ? currentUser.email : '' }).then(function(res) {
    if (!res || !res.ok) return hide();
    var polls = res.data || [];
    if (typeof _votingCache_ !== 'undefined') _votingCache_.list = polls; // reuse cache utk halaman Voting
    var active = polls.filter(function(p) { return p.status === 'Aktif'; });
    if (!active.length) return hide(); // tak ada poll aktif → tak ada banner
    // poll aktif yg masih punya blok belum vote (hanya relevan bila login)
    var pending = active.filter(function(p) {
      var total = (p.myBlocks || []).length;
      var voted = (p.votedBlocks || []).length;
      return total > 0 && voted < total;
    });
    var ttl = document.getElementById('votingBannerTitle');
    var sub = document.getElementById('votingBannerSub');
    if (!loggedIn) {
      // guest: ajak ikut voting (klik → diminta login)
      if (ttl) ttl.textContent = active.length > 1 ? (active.length + ' voting berlangsung') : 'Ada voting baru';
      if (sub) sub.textContent = active.length === 1
        ? (active[0].judul || 'Login untuk ikut voting')
        : 'Login untuk ikut voting';
    } else if (pending.length) {
      // login & ada yg belum divote → ajak vote
      if (ttl) ttl.textContent = pending.length > 1
        ? (pending.length + ' voting menunggu suara Anda')
        : 'Ada voting baru';
      if (sub) sub.textContent = pending.length === 1
        ? (pending[0].judul || 'Ketuk untuk berpartisipasi')
        : 'Ketuk untuk berpartisipasi';
    } else {
      // login & sudah vote semua, tapi voting masih berlangsung → lihat hasil
      if (ttl) ttl.textContent = 'Lihat hasil voting';
      if (sub) sub.textContent = active.length === 1
        ? (active[0].judul || 'Voting sedang berlangsung')
        : (active.length + ' voting sedang berlangsung');
    }
    wrap.classList.remove('hidden');
  }).catch(hide);
}

// Klik banner Voting: guest → minta login dulu; login → buka halaman Voting
function _openVotingFromBanner_() {
  if (!currentUser || !currentUser.email) {
    if (typeof openLoginRequiredModal === 'function') {
      openLoginRequiredModal('Login dulu untuk ikut voting.');
    } else if (typeof showToast === 'function') {
      showToast('Login dulu untuk ikut voting', 'info');
    }
    return;
  }
  openVotingPage();
}

function loadHeaderGreeting() {

  gasGet_('getActiveGreeting')
    .then(function(res) {
      if (!res || !res.success || !res.text) {
        // Tidak ada greeting aktif — sembunyikan banner
        var wrap = document.getElementById('greetingBannerWrap');
        if (wrap) wrap.classList.add('hidden');
        return;
      }
      var items = res.items || (Array.isArray(res.texts)
        ? res.texts.map(function(t){ return { judul: t, konten: '' }; })
        : [{ judul: res.text || '', konten: '' }]);
      homeDataCache.greeting = items;
      startGreetingBanner_(items);
    })
    .catch(function() {});
}

var _greetingToken_ = 0; // incremented every new run — old runs self-cancel

function startGreetingRotation_(greetings, textEl, greetEl) {
  if (!greetings || !greetings.length) return;

  // Kill all previous runs
  _greetingToken_++;
  var myToken = _greetingToken_;

  greetEl.classList.remove('hidden');
  textEl.innerText = '';
  textEl.style.borderRight = '';
  textEl.style.animation = '';

  var idx = 0;

  function alive() { return myToken === _greetingToken_; }

  function cursorOn()  {
    textEl.style.borderRight = '2px solid rgba(255,255,255,0.85)';
    textEl.style.animation   = 'greetCursor 0.5s step-end infinite';
  }
  function cursorOff() {
    textEl.style.borderRight = '';
    textEl.style.animation   = '';
  }

  function typeText(text, onDone) {
    if (!alive()) return;
    textEl.innerText = '';
    cursorOn();
    var i = 0;
    (function tick() {
      if (!alive()) return;
      if (i <= text.length) {
        textEl.innerText = text.slice(0, i);
        i++;
        setTimeout(tick, 55);
      } else {
        cursorOff();
        if (onDone) setTimeout(onDone, greetings.length > 1 ? 2800 : 9999999);
      }
    })();
  }

  function eraseText(onDone) {
    if (!alive()) return;
    cursorOn();
    var str = textEl.innerText;
    var i   = str.length;
    (function tick() {
      if (!alive()) return;
      if (i >= 0) {
        textEl.innerText = str.slice(0, i);
        i--;
        setTimeout(tick, 28);
      } else {
        cursorOff();
        if (onDone) setTimeout(onDone, 180);
      }
    })();
  }

  function showNext() {
    if (!alive()) return;
    if (greetings.length > 1) {
      eraseText(function() {
        if (!alive()) return;
        idx = (idx + 1) % greetings.length;
        typeText(greetings[idx], showNext);
      });
    }
  }

  // Small delay so page-transition animation doesn't overlap
  setTimeout(function() {
    if (!alive()) return;
    typeText(greetings[0], showNext);
  }, 300);
}

function preloadContactData() {
  if (homeDataCache.contact) return; // sudah ada
  gasGet_('getNonSecurityContacts')
    .then(function(res) { homeDataCache.contact = res; })
    .catch(function() {});
}

function preloadSecurityContacts() {
  if (homeDataCache.security) return; // sudah ada
  gasGet_('getSecurityContacts')
    .then(function(res) { homeDataCache.security = res; })
    .catch(function() {});
}

// --- TUNGGAKAN ---
function loadHomeTunggakan() {
  const nomEl   = document.getElementById('homeIplNominal');
  const badgeEl = document.getElementById('homeIplBadge');
  if (!nomEl) return;

  if (!currentUser || !currentUser.email) {
    nomEl.innerHTML = 'Rp&nbsp;<span style="letter-spacing:2px">••••••</span>';
    badgeEl.innerText = '—';
    badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white';

    var monthEl = document.getElementById('homeIplMonth');
    if (monthEl) monthEl.innerText = 's.d. bulan ini';

    // CTA button
    var ctaEl = document.getElementById('tunggakanLoginCTA');
    if (!ctaEl) {
      var card = document.getElementById('homeTunggakanCard');
      if (card) {
        var cta = document.createElement('button');
        cta.id = 'tunggakanLoginCTA';
        cta.onclick = function() { openPageSaya(); };
        cta.className = 'mt-3 px-4 py-1.5 rounded-xl bg-white text-primary text-xs font-bold active:scale-95 transition inline-block relative z-10';
        cta.innerText = 'Masuk sekarang →';
        var zEl = card.querySelector('.relative.z-10');
        if (zEl) zEl.appendChild(cta);
      }
    }
    return;
  }

  // hapus CTA jika sudah login
  var ctaEl = document.getElementById('tunggakanLoginCTA');
  if (ctaEl) ctaEl.remove();

  nomEl.innerText = 'Memuat...';
  gasGet_('getWargaTunggakan', { email: currentUser.email })
    .then(function(res) {
      console.log('[tunggakan res]', JSON.stringify(res));
      homeDataCache.tunggakan = res;
      if (!res || !res.ok) {
        nomEl.innerHTML = 'Rp 0';
        badgeEl.innerHTML = '<span style="display:flex;align-items:center;gap:5px;"><svg style="width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Lunas</span>';
        badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white';
        var labelElFail = document.querySelector('#homeTunggakanCard .text-blue-200');
        if (labelElFail) labelElFail.innerText = 'Status IPL';
        var monthElFail = document.getElementById('homeIplMonth');
        if (monthElFail) monthElFail.innerText = 'Tidak ada tagihan saat ini';
        return;
      }
      const monthEl = document.getElementById('homeIplMonth');
      if (monthEl) {
        if (res.items && res.items.length > 0) {
          const last = res.items[res.items.length - 1];
          const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
          monthEl.innerText = 's.d. ' + (monthNames[last.monthIdx0] || '') + ' ' + (last.year || '');
        } else {
          const now = new Date();
          const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
          monthEl.innerText = monthNames[now.getMonth()] + ' ' + now.getFullYear();
        }
      }
      if (res.total === 0) {
        var monthNames2 = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        var now2 = new Date();
        var paidNow = (wargaPaidMonths && wargaPaidMonths[now2.getFullYear()]) || [];
        var nextUnpaidMonth = -1;
        for (var mi = now2.getMonth(); mi < 12; mi++) {
          if (!paidNow.includes(mi)) { nextUnpaidMonth = mi; break; }
        }
        var hasUpcoming = res.upcoming > 0 && nextUnpaidMonth >= 0;
        if (hasUpcoming) {
          nomEl.innerText = 'Rp ' + Number(res.upcoming).toLocaleString('id-ID');
        } else {
          nomEl.innerText = 'Rp 0';
          nomEl.style.fontSize = '1.5rem';
        }

        // === HITUNG FASE JATUH TEMPO ===
        var dueDatePhase = 'normal'; // normal | warning | overdue | late
        var dueBadgeText = '';
        var cardBg = hasUpcoming ? '#1d4ed8' : 'linear-gradient(135deg, #1e3a8a, #1d4ed8)';

        if (hasUpcoming && res.dueDate) {
          var today = new Date();
          // var today = new Date('2026-04-25');
          today.setHours(0, 0, 0, 0);
          var due = new Date(res.dueDate);
          due.setHours(0, 0, 0, 0);
          var diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

          if (diffDays > 7) {
            // Normal — hijau
            dueDatePhase = 'normal';
          } else if (diffDays >= 1) {
            // Reminder H-7 s/d H-1 — kuning
            dueDatePhase = 'reminder';
            dueBadgeText = 'bell|Jatuh tempo ' + diffDays + ' hari lagi';
            cardBg = 'linear-gradient(135deg, #713f12, #ca8a04)';
          } else if (diffDays === 0) {
            // Hari H — oranye
            dueDatePhase = 'due';
            dueBadgeText = 'clock|Jatuh tempo hari ini';
            cardBg = 'linear-gradient(135deg, #7c2d12, #ea580c)';
          } else if (diffDays >= -7) {
            // Overdue H+1 s/d H+7 — merah
            dueDatePhase = 'overdue';
            dueBadgeText = 'alert|Terlambat ' + Math.abs(diffDays) + ' hari';
            cardBg = 'linear-gradient(135deg, #7f1d1d, #b91c1c)';
          } else {
            // Late H+7+ — merah gelap
            dueDatePhase = 'late';
            dueBadgeText = 'alert|Terlambat ' + Math.abs(diffDays) + ' hari';
            cardBg = 'linear-gradient(135deg, #3b0a0a, #7f1d1d)';
          }
        }

        badgeEl.innerHTML = '<span style="display:flex;align-items:center;gap:5px;"><svg style="width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Lunas</span>';
        badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white';
        var labelEl = document.querySelector('#homeTunggakanCard .text-blue-200');
        var cardLabel = 'Status IPL';
        if (hasUpcoming) {
          if (dueDatePhase === 'due') cardLabel = 'Jatuh Tempo Hari Ini';
          else if (dueDatePhase === 'overdue') cardLabel = 'Segera Lunasi';
          else if (dueDatePhase === 'late') cardLabel = 'Tunggakan Belum Dibayar';
          else cardLabel = 'Tagihan Berikutnya';
        }
        if (labelEl) labelEl.innerText = cardLabel;
        var monthEl2 = document.getElementById('homeIplMonth');
        if (monthEl2) {
          if (hasUpcoming) {
            monthEl2.innerText = monthNames2[nextUnpaidMonth] + ' ' + now2.getFullYear();
          } else {
            monthEl2.innerText = 'Tidak ada tagihan saat ini';
          }
        }

        // Tambah badge fase jatuh tempo
        var existingDueBadge = document.getElementById('dueDateBadge');
        if (existingDueBadge) existingDueBadge.remove();
        if (dueBadgeText) {
          var badgeParts = dueBadgeText.split('|');
          var badgeIcon  = badgeParts[0];
          var badgeLabel = badgeParts[1] || '';

          var iconSvg = '';
          if (badgeIcon === 'bell') {
            iconSvg = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
          } else if (badgeIcon === 'clock') {
            iconSvg = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
          } else if (badgeIcon === 'alert') {
            iconSvg = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
          }

          var dueBadgeEl = document.createElement('div');
          dueBadgeEl.id = 'dueDateBadge';
          dueBadgeEl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.92);margin-top:6px;';
          dueBadgeEl.innerHTML = iconSvg + '<span>' + badgeLabel + '</span>';
          var nomParent = nomEl.parentElement;
          if (nomParent) nomParent.appendChild(dueBadgeEl);
        }

        var card = document.getElementById('homeTunggakanCard');
        if (card) {
          card.style.background = cardBg;
        }
      } else {
        nomEl.innerText = 'Rp ' + Number(res.total).toLocaleString('id-ID');
        badgeEl.innerText = res.items.length + ' bulan';
        badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-red-400/80 text-white';
        var labelEl = document.querySelector('#homeTunggakanCard .text-blue-200');
        if (labelEl) labelEl.innerText = 'Total Tunggakan';

        // Hitung fase overdue untuk tunggakan
        if (res.dueDate) {
          var todayOvd = new Date();
          todayOvd.setHours(0, 0, 0, 0);
          var dueOvd = new Date(res.dueDate);
          dueOvd.setHours(0, 0, 0, 0);
          var diffOvd = Math.round((dueOvd - todayOvd) / (1000 * 60 * 60 * 24));

          var ovdBg = '';
          var ovdBadgeIcon = '';
          var ovdBadgeText = '';

          if (diffOvd >= 1) {
            ovdBg = 'linear-gradient(135deg, #713f12, #ca8a04)';
            ovdBadgeIcon = 'bell';
            ovdBadgeText = 'Jatuh tempo ' + diffOvd + ' hari lagi';
          } else if (diffOvd === 0) {
            ovdBg = 'linear-gradient(135deg, #7c2d12, #ea580c)';
            ovdBadgeIcon = 'clock';
            ovdBadgeText = 'Jatuh tempo hari ini';
            if (labelEl) labelEl.innerText = 'Jatuh Tempo Hari Ini';
          } else if (diffOvd >= -7) {
            ovdBg = 'linear-gradient(135deg, #7f1d1d, #b91c1c)';
            ovdBadgeIcon = 'alert';
            ovdBadgeText = 'Terlambat ' + Math.abs(diffOvd) + ' hari';
            if (labelEl) labelEl.innerText = 'Segera Lunasi';
          } else {
            ovdBg = 'linear-gradient(135deg, #3b0a0a, #7f1d1d)';
            ovdBadgeIcon = 'alert';
            ovdBadgeText = 'Terlambat ' + Math.abs(diffOvd) + ' hari';
            if (labelEl) labelEl.innerText = 'Tunggakan Belum Dibayar';
          }

          var cardOvd = document.getElementById('homeTunggakanCard');
          if (cardOvd && ovdBg) cardOvd.style.background = ovdBg;

          // Render badge
          var existingOvdBadge = document.getElementById('dueDateBadge');
          if (existingOvdBadge) existingOvdBadge.remove();

          if (ovdBadgeText) {
            var iconSvgOvd = '';
            if (ovdBadgeIcon === 'bell') {
              iconSvgOvd = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
            } else if (ovdBadgeIcon === 'clock') {
              iconSvgOvd = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
            } else if (ovdBadgeIcon === 'alert') {
              iconSvgOvd = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
            }
            var ovdBadgeEl = document.createElement('div');
            ovdBadgeEl.id = 'dueDateBadge';
            ovdBadgeEl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.92);margin-top:6px;';
            ovdBadgeEl.innerHTML = iconSvgOvd + '<span>' + ovdBadgeText + '</span>';
            var nomParentOvd = nomEl.parentElement;
            if (nomParentOvd) nomParentOvd.appendChild(ovdBadgeEl);
          }
        }
      }
      if (res.rate) {
        updateTarifDisplay_(true, res.rate, res);

        var isMultiBlok = res.bloks && res.bloks.length > 1;
        var allSame200 = isMultiBlok && (Number(res.rate) % 200000 === 0) && (Number(res.rate) / 200000 === res.bloks.length);
        var allSame175 = isMultiBlok && (Number(res.rate) % 175000 === 0) && (Number(res.rate) / 175000 === res.bloks.length);
        var mixedRate  = isMultiBlok && !allSame200 && !allSame175;

        var rate200 = Number(res.rate) === 200000 || allSame200 || mixedRate;
        var rate175 = Number(res.rate) === 175000 || allSame175 || mixedRate;

        var card200   = document.getElementById('tarifCard200');
        var card175   = document.getElementById('tarifCard175');
        var p200nom   = document.getElementById('tarifNominal200');
        var p175nom   = document.getElementById('tarifNominal175');
        var p200label = card200 ? card200.querySelector('p:first-child') : null;
        var p175label = card175 ? card175.querySelector('p:first-child') : null;

        // Hitung label blok per card
        var blokLabel200 = '';
        var blokLabel175 = '';
        if (isMultiBlok && res.bloks) {
          var allBloks = res.bloks.join(' & ');
          if (allSame200) {
            blokLabel200 = ' (' + allBloks + ')';
            blokLabel175 = '';
          } else if (allSame175) {
            blokLabel200 = '';
            blokLabel175 = ' (' + allBloks + ')';
          } else {
            var rateByBlok = res.rateByBlok || {};
            var bloks200 = res.bloks.filter(function(b) { return (rateByBlok[b] || 0) >= 200000; });
            var bloks175 = res.bloks.filter(function(b) { return (rateByBlok[b] || 0) < 200000 && (rateByBlok[b] || 0) > 0; });
            blokLabel200 = bloks200.length ? ' (' + bloks200.join(' & ') + ')' : '';
            blokLabel175 = bloks175.length ? ' (' + bloks175.join(' & ') + ')' : '';
          }
        }

        if (card200) {
          if (rate200) {
            card200.style.background   = '#eff6ff';
            card200.style.borderTop    = '3px solid #2563eb';
            card200.style.borderRight  = '1px solid #bfdbfe';
            card200.style.borderBottom = '1px solid #bfdbfe';
            card200.style.borderLeft   = '1px solid #bfdbfe';
            card200.style.opacity      = '1';
            if (p200nom) { p200nom.style.color = '#1d4ed8'; }
          } else {
            card200.style.background   = '#fafafa';
            card200.style.borderTop    = '3px solid transparent';
            card200.style.borderRight  = '1px solid #f3f4f6';
            card200.style.borderBottom = '1px solid #f3f4f6';
            card200.style.borderLeft   = '1px solid #f3f4f6';
            card200.style.opacity      = '0.5';
            if (p200nom) { p200nom.style.color = ''; }
          }
          if (!document.getElementById('tarifBadge200') && rate200 && p200label) {
            var badge200 = document.createElement('span');
            badge200.id = 'tarifBadge200';
            badge200.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:#1d4ed8;background:#dbeafe;border-radius:999px;padding:2px 7px;margin-left:6px;letter-spacing:0.02em;vertical-align:middle;';
            badge200.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg> Tarif Anda';
            p200label.appendChild(badge200);
          }
          if (isMultiBlok && blokLabel200 && !document.getElementById('tarifBlokLabel200') && p200label) {
            var blokSpan200 = document.createElement('span');
            blokSpan200.id = 'tarifBlokLabel200';
            blokSpan200.style.cssText = 'display:block;font-size:9px;color:#2563eb;font-weight:600;margin-top:2px;';
            blokSpan200.innerText = blokLabel200;
            p200label.appendChild(blokSpan200);
          }
        }
        if (card175) {
          if (rate175) {
            card175.style.background   = '#eff6ff';
            card175.style.borderTop    = '3px solid #2563eb';
            card175.style.borderRight  = '1px solid #bfdbfe';
            card175.style.borderBottom = '1px solid #bfdbfe';
            card175.style.borderLeft   = '1px solid #bfdbfe';
            card175.style.opacity      = '1';
            if (p175nom) { p175nom.style.color = '#1d4ed8'; }
          } else {
            card175.style.background   = '#fafafa';
            card175.style.borderTop    = '3px solid transparent';
            card175.style.borderRight  = '1px solid #f3f4f6';
            card175.style.borderBottom = '1px solid #f3f4f6';
            card175.style.borderLeft   = '1px solid #f3f4f6';
            card175.style.opacity      = '0.5';
            if (p175nom) { p175nom.style.color = ''; }
          }
          if (!document.getElementById('tarifBadge175') && rate175 && p175label) {
            var badge175 = document.createElement('span');
            badge175.id = 'tarifBadge175';
            badge175.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:#1d4ed8;background:#dbeafe;border-radius:999px;padding:2px 7px;margin-left:6px;letter-spacing:0.02em;vertical-align:middle;';
            badge175.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg> Tarif Anda';
            p175label.appendChild(badge175);
          }
          if (isMultiBlok && blokLabel175 && !document.getElementById('tarifBlokLabel175') && p175label) {
            var blokSpan175 = document.createElement('span');
            blokSpan175.id = 'tarifBlokLabel175';
            blokSpan175.style.cssText = 'display:block;font-size:9px;color:#1d4ed8;font-weight:600;margin-top:2px;';
            blokSpan175.innerText = blokLabel175;
            p175label.appendChild(blokSpan175);
          }
        }
        if (p200label) p200label.style.color = rate200 ? '#1d4ed8' : '#6b7280';
        if (p175label) p175label.style.color = rate175 ? '#1d4ed8' : '#6b7280';
      }
    })
    .catch(function() {
      nomEl.innerText = 'Gagal memuat';
    });
}

function openTunggakanDetail() {
  var cache = homeDataCache.tunggakan;
  var modal = document.getElementById('tunggakanModal');
  if (!modal) return;

  if (!currentUser || !currentUser.email) {
    openPageSaya();
    return;
  }

  var blokEl  = document.getElementById('tunggakanModalBlok');
  var listEl  = document.getElementById('tunggakanModalList');
  var totalEl = document.getElementById('tunggakanModalTotal');

  if (!cache || !cache.ok) {
    showToast('Data belum tersedia, coba refresh', 'warning');
    return;
  }

  blokEl.innerText  = 'Blok ' + (cache.blok || '-');
  totalEl.innerText = 'Rp ' + Number(cache.total || 0).toLocaleString('id-ID');

  // Tambah info jatuh tempo di modal
  var existingDueInfo = document.getElementById('tunggakanModalDueInfo');
  if (existingDueInfo) existingDueInfo.remove();

  if (cache.dueDate && cache.upcoming > 0) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var due = new Date(cache.dueDate);
    due.setHours(0, 0, 0, 0);
    var diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

    var dueText = '';
    var dueColor = '';
    if (diffDays > 7) {
      dueText = 'Jatuh tempo ' + due.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      dueColor = '#2563eb';
    } else if (diffDays >= 1) {
      dueText = '🔔 Jatuh tempo ' + diffDays + ' hari lagi (' + due.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ')';
      dueColor = '#b45309';
    } else if (diffDays === 0) {
      dueText = '⏰ Jatuh tempo hari ini';
      dueColor = '#ea580c';
    } else if (diffDays >= -7) {
      dueText = '⚠️ Terlambat ' + Math.abs(diffDays) + ' hari';
      dueColor = '#b91c1c';
    } else {
      dueText = '⚠️ Terlambat ' + Math.abs(diffDays) + ' hari';
      dueColor = '#7f1d1d';
    }

    var dueInfoEl = document.createElement('div');
    dueInfoEl.id = 'tunggakanModalDueInfo';
    dueInfoEl.style.cssText = 'font-size:12px;font-weight:600;color:' + dueColor + ';padding:8px 0 4px 0;';
    dueInfoEl.innerText = dueText;
    blokEl.parentElement.insertBefore(dueInfoEl, blokEl.nextSibling);
  }

  var upcomingItem = cache.upcomingItem || null;
  var grandTotal = (cache.total || 0) + (upcomingItem ? upcomingItem.amount : 0);

  if (!cache.items || cache.items.length === 0) {
    if (!upcomingItem) {
      listEl.innerHTML =
        '<div class="flex flex-col items-center py-6 gap-2">' +
          '<div class="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">' +
            '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
              '<path d="M20 6L9 17l-5-5"/>' +
            '</svg>' +
          '</div>' +
          '<p class="text-sm font-semibold text-gray-900">Semua lunas!</p>' +
          '<p class="text-xs text-gray-400">Tidak ada tunggakan IPL</p>' +
        '</div>';
    } else {
      listEl.innerHTML = '';
    }
  } else {
    listEl.innerHTML = cache.items.map(function(d) {
      var amt = 'Rp ' + Number(d.amount || 0).toLocaleString('id-ID');
      var lbl = (d.name || '') + (d.year ? ' ' + d.year : '');
      var isOverdue = d.year < new Date().getFullYear() ||
        (d.year === new Date().getFullYear() && d.monthIdx0 < new Date().getMonth());
      return '<div class="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:' + (isOverdue ? '#f87171' : '#fbbf24') + ';"></div>' +
          '<span class="text-sm text-gray-700">' + lbl + '</span>' +
        '</div>' +
        '<span class="text-sm font-semibold" style="color:' + (isOverdue ? '#dc2626' : '#374151') + ';">' + amt + '</span>' +
      '</div>';
    }).join('');
  }

  // Tambah upcoming item jika ada
  if (upcomingItem) {
    var upAmt = 'Rp ' + Number(upcomingItem.amount).toLocaleString('id-ID');
    var upLbl = upcomingItem.name + ' ' + upcomingItem.year + ' (Upcoming)';
    listEl.innerHTML +=
      '<div class="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:#2563eb;"></div>' +
          '<span class="text-sm" style="color:#2563eb;">' + upLbl + '</span>' +
        '</div>' +
        '<span class="text-sm font-semibold" style="color:#2563eb;">' + upAmt + '</span>' +
      '</div>';
  }

  // Update total & tombol bayar
  totalEl.innerText = 'Rp ' + Number(grandTotal).toLocaleString('id-ID');
  var bayarBtn = document.getElementById('tunggakanBayarBtn');
  if (bayarBtn) {
    bayarBtn.innerText = 'Bayar Sekarang';
  }

  modal.classList.remove('hidden');
}

function closeTunggakanModal() {
  document.getElementById('tunggakanModal').classList.add('hidden');
}

// --- FASUM ---
var FASUM_ICON_SVG = {
  gate : '<path d="M3 21h18M3 7v14M21 7v14M6 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3"/><rect x="9" y="11" width="6" height="10"/>',
  cctv : '<path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.868v6.264a1 1 0 0 1-1.447.937L15 14"/><rect x="2" y="7" width="13" height="10" rx="2"/>',
  park : '<path d="M12 22V12"/><path d="M5 12a7 7 0 0 0 7-7 7 7 0 0 0 7 7"/><path d="M5 19a7 7 0 0 0 7-7 7 7 0 0 0 7 7"/>',
  lamp : '<path d="M12 2v6"/><path d="M9.17 3.17A8 8 0 0 0 12 18"/><path d="M14.83 3.17A8 8 0 0 1 12 18"/><path d="M8 22h8M12 18v4"/>',
  pool : '<path d="M2 12h20M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M6 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/>',
  road : '<path d="M3 3h18v4H3z"/><path d="M3 17h18v4H3z"/><path d="M11 7v10M13 7v10"/>',
  power: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  water: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/>',
  hall : '<path d="M3 11.5L12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>',
  trash: '<path d="M3 6h18M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>',
  sport: '<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93c4.08 4.08 10.14 4.08 14.14 0"/><path d="M4.93 19.07c4.08-4.08 10.14-4.08 14.14 0"/><path d="M12 2v20"/>'
};

function getFasumIconSvg(key) {
  return FASUM_ICON_SVG[key] ||
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>';
}

function getFasumStatusStyle(status) {
  var s = (status || '').toLowerCase();
  if (s === 'normal')      return { dot: 'bg-blue-400',  text: 'text-blue-700',  label: 'Normal',      cardBg: 'bg-gradient-to-b from-blue-50 to-white',  cardBorder: 'border-blue-100', iconBg: 'bg-blue-500',  iconColor: 'text-white', pillBg: 'bg-blue-100', pillText: 'text-blue-700' };
  if (s === 'maintenance') return { dot: 'bg-amber-400',  text: 'text-amber-700',  label: 'Maintenance', cardBg: 'bg-gradient-to-b from-amber-50 to-white',  cardBorder: 'border-amber-100', iconBg: 'bg-amber-400',  iconColor: 'text-white', pillBg: 'bg-amber-100', pillText: 'text-amber-700' };
  return                          { dot: 'bg-red-400',    text: 'text-red-700',    label: status || 'Gangguan', cardBg: 'bg-gradient-to-b from-red-50 to-white', cardBorder: 'border-red-100', iconBg: 'bg-red-500', iconColor: 'text-white', pillBg: 'bg-red-100', pillText: 'text-red-700' };
}

function loadHomeFasum() {
  const el = document.getElementById('homeFasumList');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = '<div class="col-span-3 flex flex-col items-center justify-center gap-2 py-6 px-4">' +
      '<div class="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500 text-center">Login untuk melihat Info Fasum</p>' +
      '<button onclick="openMePage()" class="mt-1 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl active:scale-95 transition">Masuk Sekarang</button>' +
    '</div>';
    return;
  }

  gasGet_('getFasumData')
    .then(function(res) {
      homeDataCache.fasum = res;
      if (!res || !res.ok || !res.data.length) {
        el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Data fasum belum tersedia</p>';
        return;
      }
      renderFasumList(false);
    })
    .catch(function() {
      document.getElementById('homeFasumList').innerHTML =
        '<p class="text-sm text-red-400 text-center py-4">Gagal memuat data fasum</p>';
    });
}

function buildFasumItemHtml(f) {
  var st  = getFasumStatusStyle(f.status);
  var ico = getFasumIconSvg(f.icon);
  return '<div class="fasum-card rounded-2xl border ' + st.cardBorder + ' ' + st.cardBg + ' flex flex-col items-center pt-3.5 pb-3 px-2 gap-1.5">' +
    '<div class="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm ' + st.iconBg + '">' +
      '<svg class="w-5 h-5 ' + st.iconColor + '" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
        ico +
      '</svg>' +
    '</div>' +
    '<p class="text-[10.5px] font-bold text-gray-800 leading-snug text-center line-clamp-2 w-full">' + f.nama + '</p>' +
    '<div class="flex items-center gap-1 rounded-full px-2 py-0.5 mt-auto ' + st.pillBg + '">' +
      '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0 ' + st.dot + '"></div>' +
      '<span class="text-[9px] font-semibold ' + st.pillText + ' whitespace-nowrap">' + st.label + '</span>' +
    '</div>' +
  '</div>';
}

function renderFasumList(showAll) {
  var el  = document.getElementById('homeFasumList');
  var res = homeDataCache.fasum;
  if (!el || !res || !res.data) return;

  el.className = 'grid grid-cols-3 gap-2.5 px-4 pb-4 pt-2';
  el.innerHTML = res.data.map(buildFasumItemHtml).join('');
}

// --- INFO CLUSTER ---
var KATEGORI_META = {
  'pengumuman' : { bg: 'bg-blue-500',   emoji: '📢' },
  'keamanan'   : { bg: 'bg-red-500',    emoji: '🔒' },
  'lingkungan' : { bg: 'bg-blue-600',  emoji: '🌿' },
  'sosial'     : { bg: 'bg-purple-500', emoji: '🤝' },
  'keuangan'   : { bg: 'bg-orange-500', emoji: '💰' },
  'event'      : { bg: 'bg-pink-500',   emoji: '🎉' },
  'fasilitas'  : { bg: 'bg-blue-500',   emoji: '🏗️' }
};

function getKategoriMeta(kat) {
  return KATEGORI_META[(kat || '').toLowerCase()] || { bg: 'bg-gray-500', emoji: '📌' };
}

function loadHomeInfo() {
  const el = document.getElementById('homeInfoCarousel');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = '<div class="flex-shrink-0 w-full flex flex-col items-center justify-center gap-2 py-6 px-4 snap-start">' +
      '<div class="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500 text-center">Login untuk melihat Info Cluster</p>' +
      '<button onclick="openMePage()" class="mt-1 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl active:scale-95 transition">Masuk Sekarang</button>' +
    '</div>';
    return;
  }

  gasGet_('getInfoData')
    .then(function(res) {
      homeDataCache.info = res;
      if (!res || !res.ok || !res.data.length) {
        el.innerHTML = '<div class="flex-shrink-0 w-64 rounded-2xl bg-gray-100 flex items-center justify-center h-28 snap-start"><p class="text-sm text-gray-400">Belum ada info</p></div>';
        return;
      }
      el.innerHTML = res.data.map(function(item, idx) {
        var meta = getKategoriMeta(item.kategori);
        return '<div class="flex-shrink-0 w-56 rounded-2xl snap-start cursor-pointer active:scale-[0.97] transition overflow-hidden border border-gray-100 shadow-sm" onclick="openInfoArtikel(' + idx + ')">' +
          '<div class="' + meta.bg + ' px-4 pt-3 pb-4 relative overflow-hidden">' +
            '<div class="absolute -right-4 -bottom-4 w-20 h-20 rounded-full bg-white/10"></div>' +
            '<div class="absolute right-3 top-2.5 text-xl opacity-90">' + meta.emoji + '</div>' +
            '<p class="text-[9px] uppercase tracking-widest text-white/70 font-bold">' + (item.kategori || 'Info') + '</p>' +
            '<p class="text-sm font-bold text-white mt-1 leading-snug pr-8">' + item.judul + '</p>' +
          '</div>' +
          '<div class="bg-white px-4 py-2.5 flex items-center justify-between">' +
            '<p class="text-[11px] text-gray-400">' + (item.tanggal || '') + '</p>' +
            '<svg class="w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      document.getElementById('homeInfoCarousel').innerHTML =
        '<div class="flex-shrink-0 w-64 rounded-2xl bg-gray-100 flex items-center justify-center h-28 snap-start"><p class="text-sm text-red-400">Gagal memuat</p></div>';
    });
}

function formatInfoKonten(text) {
  if (!text) return '';

  // Split per baris
  var lines = text.split('\n');
  var result = [];
  var listItems = [];

  function flushList() {
    if (!listItems.length) return;
    var html = '<div class="space-y-2 my-3">';
    listItems.forEach(function(item, i) {
      html += '<div class="flex gap-3 items-start">' +
        '<div class="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">' +
          '<span class="text-[10px] font-bold text-primary">' + (i + 1) + '</span>' +
        '</div>' +
        '<p class="text-sm text-gray-700 leading-relaxed flex-1">' + item + '</p>' +
      '</div>';
    });
    html += '</div>';
    result.push(html);
    listItems = [];
  }

  lines.forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) {
      flushList();
      result.push('<div class="h-3"></div>');
      return;
    }
    // Detect: "1. teks" atau "1) teks"
    // Strip invisible unicode chars setelah angka/titik sebelum match
    var cleaned = trimmed.replace(/[\u2060\u200B\u200C\u200D\uFEFF\u00A0]/g, ' ').trim();
    var match = cleaned.match(/^\d+[\.\)]\s*(.+)/);
    var bulletMatch = cleaned.match(/^[\*\-]\s+(.+)/);
    if (match) trimmed = cleaned;
    if (match) {
      listItems.push(match[1].trim());
    } else if (bulletMatch) {
      flushList();
      result.push(
        '<div class="flex gap-3 items-start my-1">' +
          '<div class="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">' +
            '<div class="w-1.5 h-1.5 rounded-full bg-primary"></div>' +
          '</div>' +
          '<p class="text-sm text-gray-700 leading-relaxed flex-1">' + bulletMatch[1].trim() + '</p>' +
        '</div>'
      );
    } else {
      flushList();
      result.push('<p class="text-sm text-gray-700 leading-relaxed">' + trimmed + '</p>');
    }
  });

  flushList();
  return result.join('');
}

function openInfoArtikel(idx) {
  const cache = homeDataCache.info;
  if (!cache || !cache.data || !cache.data[idx]) return;
  const item = cache.data[idx];
  document.getElementById('infoArtikelKategori').innerText = item.kategori || '';
  document.getElementById('infoArtikelJudul').innerText    = item.judul || '';
  document.getElementById('infoArtikelTanggal').innerText  = item.tanggal || '';
  document.getElementById('infoArtikelKonten').innerHTML = formatInfoKonten(item.konten || '');
  document.getElementById('infoArtikelModal').classList.remove('hidden');
}

function closeInfoArtikelModal() {
  document.getElementById('infoArtikelModal').classList.add('hidden');
}

// --- REKENING COPY ---
function copyRekening() {
  const noRek = (document.getElementById('rekening') && document.getElementById('rekening').value) || window.PWP_NOREK || '7305014010';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(noRek).then(function() {
      showCopySuccess();
    }).catch(function() { fallbackCopyRekening(noRek); });
  } else {
    fallbackCopyRekening(noRek);
  }
}

function fallbackCopyRekening(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); showCopySuccess(); } catch(e) {}
  document.body.removeChild(ta);
}

function showCopySuccess() {
  const icon = document.getElementById('copyRekeningIcon');
  if (icon) {
    icon.innerHTML = '<path d="M20 6L9 17l-5-5"/>';
    icon.classList.add('text-primary');
    icon.classList.remove('text-gray-500');
    setTimeout(function() {
      icon.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
      icon.classList.remove('text-primary');
      icon.classList.add('text-gray-500');
    }, 2000);
  }
  showToast('Nomor rekening disalin', 'success');
}

// ============================================================
// ADMIN BAYAR PICKER
// ============================================================

function openAdminBayarPicker() {
  var picker = document.getElementById('adminBayarPicker');
  if (!picker) return;

  // Set label blok admin
  var labelEl = document.getElementById('adminBayarBlokLabel');
  if (labelEl) {
    if (Array.isArray(currentUser.wargaData) && currentUser.wargaData.length) {
      labelEl.innerText = currentUser.wargaData.map(function(d) { return d.blok; }).join(', ');
    } else {
      labelEl.innerText = 'Memuat...';
      gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
        .then(function(res) {
          if (res && res.success) {
            currentUser.wargaData = res.data || [];
            labelEl.innerText = currentUser.wargaData.map(function(d) { return d.blok; }).join(', ');
          }
        });
    }
  }

  picker.classList.remove('hidden');
}

function closeAdminBayarPicker() {
  var picker = document.getElementById('adminBayarPicker');
  if (picker) picker.classList.add('hidden');
}

function cancelAdminBayarPicker() {
  closeAdminBayarPicker();
  closeSheet();
}

function adminPilihSendiri() {
  closeAdminBayarPicker();

  // Reveal sheet DOM now (was deferred until after picker selection)
  document.body.classList.add('ipl-form-open');
  var _s = document.getElementById('sheet');
  var _o = document.getElementById('overlay');
  if (_s) { _s.scrollTop = 0; _s.classList.remove('translate-y-[120%]'); }
  if (_o) _o.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  var _ti = document.getElementById('tanggal');
  if (_ti && !_ti.value) _ti.value = formatDateISO(new Date());
  if (typeof _updateTanggalUI_ === 'function') _updateTanggalUI_();

  if (!Array.isArray(currentUser.wargaData) || !currentUser.wargaData.length) {
    showToast('Data warga belum siap, coba lagi', 'warning');
    return;
  }

  fillIdentityFromWargaData_();
  var identitySection = document.getElementById('identitySection');
  if (identitySection) identitySection.classList.add('hidden');

  // Treat admin pilih blok sendiri seperti warga:
  // load paid months & apply chip state + rate
  if (currentUser && currentUser.email) {
    if (wargaPaidMonths && wargaRateByMonth) {
      showDetailPaymentSkeleton_(true);
      // Hitung defaultRate dari rateByMonth jika cachedDefaultRate kosong
      var cachedRate = currentUser._cachedDefaultRate || 0;
      if (!cachedRate && wargaRateByMonth) {
        var nowYr = new Date().getFullYear();
        var rMap = wargaRateByMonth[nowYr] || {};
        var nowM = new Date().getMonth();
        for (var mi = nowM; mi < 12; mi++) {
          var rk = nowYr + '_' + mi;
          if (rMap[rk] && rMap[rk] > 0) { cachedRate = rMap[rk]; break; }
        }
        if (!cachedRate) {
          // ambil rate pertama yang ada
          var keys = Object.keys(rMap);
          if (keys.length) cachedRate = rMap[keys[0]] || 0;
        }
      }
      setTimeout(function() {
        applyPaidMonthsData_({
          ok: true,
          paid: wargaPaidMonths,
          pending: wargaPendingMonths || {},
          rateByMonth: wargaRateByMonth,
          defaultRate: cachedRate,
          bloks: window._wargaBloks_ || [],
          rateByBlokMonth: window._rateByBlokMonth_ || null
        });
        showDetailPaymentSkeleton_(false);
      }, 300);
    } else {
      showDetailPaymentSkeleton_(true);
      gasGet_('getWargaPaidMonths', { email: currentUser.email })
        .then(function(res) {
          showDetailPaymentSkeleton_(false);
          if (!res || !res.ok) return;
          wargaPaidMonths = res.paid;
          wargaRateByMonth = res.rateByMonth || null;
          if (currentUser) currentUser._cachedDefaultRate = res.defaultRate || 0;
          applyPaidMonthsData_(res);
        })
        .catch(function() {
          showDetailPaymentSkeleton_(false);
        });
    }
  }
}

function adminPilihWarga() {
  closeAdminBayarPicker();

  // Reveal sheet DOM now (was deferred until after picker selection)
  document.body.classList.add('ipl-form-open');
  var _s = document.getElementById('sheet');
  var _o = document.getElementById('overlay');
  if (_s) { _s.scrollTop = 0; _s.classList.remove('translate-y-[120%]'); }
  if (_o) _o.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  var _ti = document.getElementById('tanggal');
  if (_ti && !_ti.value) _ti.value = formatDateISO(new Date());
  if (typeof _updateTanggalUI_ === 'function') _updateTanggalUI_();

  // Reset semua identity fields — pastikan tidak ada sisa lock dari fillIdentityFromWargaData_
  var blokEl  = document.getElementById('blok');
  var namaEl  = document.getElementById('nama');
  var emailEl = document.getElementById('email');
  var hpEl    = document.getElementById('noHp');

  // Clear values
  [blokEl, namaEl, emailEl, hpEl].forEach(function(el) {
    if (!el) return;
    el.value = '';
    el.readOnly = false;
    el.classList.remove('bg-gray-100', 'cursor-not-allowed');
    delete el.dataset.autofilled;
    el.classList.remove('autofilled');
  });

  // Reset blok khusus — harus bisa diketik
  if (blokEl) {
    blokEl.readOnly = false;
    blokEl.classList.remove('bg-gray-100', 'cursor-not-allowed');
  }

  // Sembunyikan summary card (dari fillIdentityFromWargaData_)
  var summaryCard = document.getElementById('identitySummaryCard');
  if (summaryCard) summaryCard.classList.add('hidden');

  // Reset lookup state
  isLookupLocked = false;
  multiDecisionMode = null;
  residentSuggestion = null;

  // Sembunyikan suggestion box
  var suggBox = document.getElementById('blokSuggestion');
  if (suggBox) suggBox.classList.add('hidden');

  // Tampilkan identitySection
  var identitySection = document.getElementById('identitySection');
  if (identitySection) identitySection.classList.remove('hidden');

  // Focus ke blok input
  setTimeout(function() {
    if (blokEl) blokEl.focus();
  }, 100);
}

function fillIdentityFromWargaData_() {
  var blokEl  = document.getElementById('blok');
  var namaEl  = document.getElementById('nama');
  var emailEl = document.getElementById('email');
  var hpEl    = document.getElementById('noHp');

  var first = currentUser.wargaData[0];

  if (blokEl) blokEl.value = currentUser.wargaData.map(function(d) { return d.blok; }).join(', ');
  if (namaEl)  namaEl.value  = first.nama  || '';
  if (emailEl) emailEl.value = first.email || currentUser.email || '';
  if (hpEl)    hpEl.value    = first.noHp  || '';

  lockIdentityFields();
  isLookupLocked = true;

  if (blokEl) {
    blokEl.readOnly = true;
    blokEl.classList.add('bg-gray-100', 'cursor-not-allowed');
  }

  // Tampilkan summary card, sembunyikan identitySection
  var summaryCard = document.getElementById('identitySummaryCard');
  var summaryName = document.getElementById('identitySummaryName');
  var summaryBlok = document.getElementById('identitySummaryBlok');
  var identitySection = document.getElementById('identitySection');

  if (summaryCard && currentUser) {
    if (summaryName) summaryName.innerText = first.nama || currentUser.fullName || '';
    if (summaryBlok) summaryBlok.innerText = 'Blok ' + currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
    summaryCard.classList.remove('hidden');
  }

  if (identitySection) identitySection.classList.add('hidden');
}

// ============================================================
// CONTACT CENTER
// ============================================================

function openContactModal() {
  var modal = document.getElementById('contactModal');
  var listEl = document.getElementById('contactList');
  if (!modal || !listEl) return;

  modal.classList.remove('hidden');

  // Gunakan cache jika sudah ada
  if (homeDataCache.contact) {
    renderContactList(homeDataCache.contact, listEl);
    return;
  }

  listEl.innerHTML = '<div class="h-16 rounded-2xl bg-gray-100 animate-pulse"></div>';

  // AMBIL DATA SELAIN SECURITY
  gasGet_('getNonSecurityContacts')
    .then(function(res) {
      homeDataCache.contact = res;
      renderContactList(res, listEl);
    })
    .catch(function() {
      listEl.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Gagal memuat kontak</p>';
    });
}

function closeContactModal() {
  var modal = document.getElementById('contactModal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================
// SECURITY FLOATING BUTTON
// ============================================================

function toggleSecurityModal() {
  var overlay = document.getElementById('securityOverlay');
  if (!overlay) return;

  if (overlay.classList.contains('hidden')) {
    // Open modal
    overlay.classList.remove('hidden');

    // Load security contacts
    loadSecurityContacts();
  } else {
    // Close modal
    overlay.classList.add('hidden');
  }
}

function toggleInfoModal() {
  var overlay = document.getElementById('infoOverlay');
  if (!overlay) return;

  if (overlay.classList.contains('hidden')) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function togglePedomanModal() {
  var overlay = document.getElementById('pedomanOverlay');
  if (!overlay) return;

  if (overlay.classList.contains('hidden')) {
    // Belum login → konten terkunci, langsung arahkan ke login (jangan tampilkan list)
    if (!currentUser) {
      overlay.classList.add('hidden');
      if (typeof showToast === 'function') showToast('Login dulu untuk membuka Pedoman', 'info');
      if (typeof openMePage === 'function') openMePage();
      return;
    }
    if (navigator.vibrate) navigator.vibrate(40);
    if (typeof _updatePedomanHint_ === 'function') _updatePedomanHint_();
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

// Kontak chooser: pilih Security (SOS) atau Pengurus
function openKontakChooser() {
  var overlay = document.getElementById('kontakChooserOverlay');
  if (!overlay) return;
  if (navigator.vibrate) navigator.vibrate(30);
  overlay.classList.remove('hidden');
}

function closeKontakChooser() {
  var overlay = document.getElementById('kontakChooserOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function _securityLoadingHTML_() {
  return '<div class="flex flex-col items-center justify-center gap-2 py-8 text-gray-400">' +
    '<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">' +
      '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
      '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>' +
    '</svg>' +
    '<p class="text-xs">Memuat kontak security...</p>' +
  '</div>';
}

function loadSecurityContacts() {
  var listEl = document.getElementById('securityContactList');
  if (!listEl) return;

  // Gunakan cache jika sudah ada — render langsung TANPA spinner (anti "loading terus")
  if (homeDataCache.security) {
    _jagaLoadOnDutyNow_().then(function(onDutySet) {
      renderSecurityContactList(homeDataCache.security, listEl, onDutySet);
    });
    return;
  }

  listEl.innerHTML = _securityLoadingHTML_();

  // Load data from backend
  Promise.all([gasGet_('getSecurityContacts'), _jagaLoadOnDutyNow_()])
    .then(function(results) {
      var res = results[0];
      var onDutySet = results[1];
      homeDataCache.security = res;
      renderSecurityContactList(res, listEl, onDutySet);
    })
    .catch(function() {
      listEl.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Gagal memuat kontak security</p>';
    });
}

// Return Set of normalized noHp yang sedang jaga shift saat ini (hari ini)
// Cache status "Sedang Berjaga" — keyed per tanggal+shift, TTL 5 menit
var _onDutyCache_ = { key: '', ts: 0, set: null };
var _ONDUTY_TTL_ = 5 * 60 * 1000;

function _jagaLoadOnDutyNow_() {
  return _jagaLoadShiftConfig_().then(function(shiftConfig) {
    var activeShift = _jagaGetCurrentShiftName_(shiftConfig);
    if (!activeShift) return new Set();
    var today = _jagaFmtDate_(new Date());
    var key = today + '|' + activeShift;
    var now = Date.now();
    if (_onDutyCache_.set && _onDutyCache_.key === key && (now - _onDutyCache_.ts) < _ONDUTY_TTL_) {
      return _onDutyCache_.set;
    }
    return gasGet_('getJadwalJaga', { startDate: today, endDate: today }).then(function(res) {
      var onDuty = new Set();
      if (!res || !res.ok) return onDuty;
      var entry = (res.data || {})[today];
      var arr = (entry && entry.security && entry.security[activeShift]) || [];
      arr.forEach(function(s) {
        var hp = String(s.noHp || '').replace(/\D/g, '');
        if (hp) onDuty.add(hp.indexOf('0') === 0 ? '62' + hp.slice(1) : hp);
      });
      _onDutyCache_.key = key;
      _onDutyCache_.ts = now;
      _onDutyCache_.set = onDuty;
      return onDuty;
    });
  }).catch(function() { return new Set(); });
}

function renderSecurityContactList(res, listEl, onDutySet) {
  if (!listEl) return;
  if (!res || !res.ok || !res.data.length) {
    listEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Belum ada kontak security tersedia</p>';
    return;
  }
  onDutySet = onDutySet || new Set();
  var allData = res.data.slice().sort(function(a, b) {
    var hpA = String(a.noHp || '').replace(/\D/g, '');
    hpA = hpA.indexOf('0') === 0 ? '62' + hpA.slice(1) : hpA;
    var hpB = String(b.noHp || '').replace(/\D/g, '');
    hpB = hpB.indexOf('0') === 0 ? '62' + hpB.slice(1) : hpB;
    var onA = onDutySet.has(hpA) ? 1 : 0;
    var onB = onDutySet.has(hpB) ? 1 : 0;
    return onB - onA;
  });
  function buildSecurityHTML(data) {
    return data.map(function(c) {
      var hp = String(c.noHp || '').replace(/\D/g, '');
      var waHp = hp.startsWith('0') ? '62' + hp.slice(1) : hp;
      var isOnDuty = onDutySet.has(waHp);
      return '<div class="contact-item flex items-center justify-between py-2.5 border-b border-gray-50">' +
        '<div>' +
          '<p class="text-sm font-semibold text-gray-900">' + c.nama + (isOnDuty ? ' <span class="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-blue-500 px-1.5 py-0.5 rounded-full align-middle">' +
            '<svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>' +
            'Sedang Berjaga</span>' : '') + '</p>' +
          '<p class="text-xs text-gray-400">' + c.jabatan + '</p>' +
        '</div>' +
        '<div class="flex gap-1.5">' +
          '<a href="tel:+' + hp + '" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
              '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>' +
            '</svg>' +
          '</a>' +
          '<a href="https://wa.me/' + waHp + '" target="_blank" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
            '</svg>' +
          '</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  listEl.innerHTML = buildSecurityHTML(allData);

  var searchEl = document.getElementById('securitySearch');
  if (searchEl) {
    searchEl.oninput = function() {
      var q = this.value.toLowerCase();
      var filtered = allData.filter(function(c) {
        return (c.nama + c.jabatan).toLowerCase().indexOf(q) !== -1;
      });
      listEl.innerHTML = filtered.length
        ? buildSecurityHTML(filtered)
        : '<p class="text-xs text-gray-400 text-center py-3">Tidak ditemukan</p>';
    };
  }
}

function renderContactList(res, listEl) {
  if (!listEl) return;
  if (!res || !res.ok || !res.data.length) {
    listEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Belum ada kontak tersedia</p>';
    return;
  }
  var allData = res.data;
  function buildContactHTML(data) {
    return data.map(function(c) {
      var hp = String(c.noHp || '').replace(/\D/g, '').replace(/^0/, '62');
      return '<div class="contact-item flex items-center justify-between py-2.5 border-b border-gray-50">' +
        '<div>' +
          '<p class="text-sm font-semibold text-gray-900">' + c.nama + '</p>' +
          '<p class="text-xs text-gray-400">' + c.jabatan + '</p>' +
        '</div>' +
        '<div class="flex gap-1.5">' +
          '<a href="tel:+' + hp + '" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
              '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>' +
            '</svg>' +
          '</a>' +
          '<a href="https://wa.me/' + hp + '" target="_blank" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
            '</svg>' +
          '</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  listEl.innerHTML = buildContactHTML(allData);

  var searchEl = document.getElementById('contactSearch');
  if (searchEl) {
    searchEl.oninput = function() {
      var q = this.value.toLowerCase();
      var filtered = allData.filter(function(c) {
        return (c.nama + c.jabatan).toLowerCase().indexOf(q) !== -1;
      });
      listEl.innerHTML = filtered.length
        ? buildContactHTML(filtered)
        : '<p class="text-xs text-gray-400 text-center py-3">Tidak ditemukan</p>';
    };
  }
}

// Toggle panel info "Cara masuk & info penyewa" di halaman login
function _toggleSayaLoginInfo_() {
  var panel = document.getElementById('sayaLoginInfoPanel');
  var icon = document.getElementById('sayaLoginInfoIcon');
  if (!panel) return;
  var expanded = panel.classList.toggle('hidden') === false;
  if (icon) icon.style.transform = expanded ? 'rotate(180deg)' : '';
}

function backToEmailStep() {
  // Hide ALL steps first, then show email step
  ['sayaStepOTP','sayaStepMethod','sayaStepResetPIN'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.style.display = ''; }
  });
  var emailStep = document.getElementById('sayaStepEmail');
  if (emailStep) {
    emailStep.classList.remove('hidden');
    emailStep.classList.add('saya-step');
    setTimeout(function() { emailStep.classList.remove('saya-step'); }, 300);
  }
}

// Alias used by login-prompt buttons in Info Cluster, Fasum, Pedoman, etc.
function openMePage() { openPageSaya(); }

function closePageSaya() {
  document.body.classList.remove('saya-open');
  var namaInput  = document.getElementById('sayaNamaInput');
  var hpInput    = document.getElementById('sayaHpInput');
  var emailInput = document.getElementById('sayaEmailEditInput');
  var editBtn    = document.getElementById('sayaEditBtn');
  var saveBtn    = document.getElementById('sayaSaveBtn');

  [namaInput, hpInput].forEach(function(el) {
    if (!el) return;
    el.readOnly = true;
    el.style.borderBottom = '';
    el.style.paddingBottom = '';
  });

  if (editBtn) editBtn.classList.remove('hidden');
  if (saveBtn) saveBtn.classList.add('hidden');

  switchPage('homePage');
  setActiveNavById('navHome');
}

function showEmailHint_() {
    var existing = document.getElementById('emailHintBubble');
    if (existing) return;

    var bubble = document.createElement('div');
    bubble.id = 'emailHintBubble';
    bubble.style.cssText = [
      'position:fixed',
      'bottom:100px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#1f2937',
      'color:#fff',
      'font-size:13px',
      'font-weight:500',
      'padding:10px 18px',
      'border-radius:12px',
      'white-space:nowrap',
      'z-index:99999',
      'opacity:0',
      'transition:opacity 0.2s ease',
      'pointer-events:none'
    ].join(';');
    bubble.innerText = 'Untuk mengubah email, hubungi Pengurus';

    document.body.appendChild(bubble);

    requestAnimationFrame(function() {
      bubble.style.opacity = '1';
    });

    setTimeout(function() {
      bubble.style.opacity = '0';
      setTimeout(function() {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
      }, 200);
    }, 2500);
  }

function openSayaFromSheet_() {
    // Tutup sheet dulu tanpa reset cache
    document.body.classList.remove('ipl-form-open');
    var overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';

    // Buka page Saya
    setTimeout(function() {
      openPageSaya();
    }, 50);
  }

function openAboutModal() {
  document.getElementById('aboutModal').classList.remove('hidden');
}

function closeAboutModal() {
  document.getElementById('aboutModal').classList.add('hidden');
}

/* ============================================================
   EXPLORE PAGE
   ============================================================ */
function openExplore() { openAdminPage(); } // legacy alias

function openAdminPage() {
  if (!currentUser || currentUser.role !== 'admin') return;
  switchPage('explorePage');
  setActiveNavById('navAdmin');
  refreshAdminExploreSection();
  if (!history.state || !history.state.explore) {
    history.pushState({ explore: true }, '');
  }
  var exploreScroll = document.querySelector('#explorePage .flex-1.overflow-y-auto');
  if (exploreScroll) exploreScroll.scrollTop = 0;
}

/* ============================================================
   ADMIN CRUD — INFO & FASUM
   ============================================================ */

var _infoCRUDCache       = null;
var _fasumCRUDCache      = null;
var _adminLaporCache_    = null;
var _adminWargaBaruCache_ = null;

// ===== SHOW/HIDE navAdmin BASED ON ROLE =====
function updateNavAdminVisibility() {
  var btn = document.getElementById('navAdmin');
  if (!btn) return;
  var isAdmin = currentUser && currentUser.role === 'admin';
  if (isAdmin) {
    btn.classList.remove('hidden');
    btn.classList.add('flex');
  } else {
    btn.classList.add('hidden');
    btn.classList.remove('flex');
  }
}

// ===== SHOW/HIDE ADMIN SECTION =====
function refreshAdminExploreSection(forceRefresh) {
  var sec = document.getElementById('adminExploreSection');
  if (!sec) return;
  if (currentUser && currentUser.role === 'admin') {
    sec.classList.remove('hidden');
    if (forceRefresh) {
      _infoCRUDCache       = null;
      _fasumCRUDCache      = null;
      _greetingCRUDCache   = null;
      _dataWargaCache      = null;
      _adminLaporCache_    = null;
      _adminWargaBaruCache_ = null;
      _jualanQCLoaded_     = false;
      _jualanCache_        = null;
      _adminPreloaded_     = false;
      _ssClearExplore_();
    }
    loadAdminInfoPreview();
    loadAdminFasumPreview();
    loadAdminGreetingPreview();
    loadAdminWargaPreview();
    loadAdminWargaBaruPreview();
    loadAdminLaporPreview();
    loadAdminKasIplPreview();
    // Konten CRUD tampil inline di dalam tab panel
    _initAdminInlineCRUD_();
    switchAdminTab(_adminCurrentTab_ || 'info');
    // Preload SEMUA tab admin diam-diam → tab lain langsung kebuka tanpa loading
    _preloadAdminTabs_();
  } else {
    sec.classList.add('hidden');
  }
}

// Pra-muat semua tab admin di background (sekali per sesi buka admin), staggered
var _adminPreloaded_ = false;
function _preloadAdminTabs_() {
  if (_adminPreloaded_) return;
  _adminPreloaded_ = true;
  var order = ['ringkasan','pengaduan','pendaftar','warga','info','greeting','fasum','kasipl','pengeluaran','jualanqc','verifikasi'];
  var cur = _adminCurrentTab_ || 'info';
  var others = order.filter(function(k){ return k !== cur; });
  others.forEach(function(k, idx){
    setTimeout(function(){
      var loader = (typeof _ADMIN_TAB_LOADERS_ !== 'undefined') ? _ADMIN_TAB_LOADERS_[k] : null;
      if (loader) { try { loader(); } catch(e) {} }
    }, 300 * (idx + 1));   // jeda antar-fetch biar GAS tidak kebanjiran
  });
}

var _EXPLORE_CACHE_TTL = 5 * 60 * 1000; // 5 menit

function _ssGetExplore_(key) {
  try {
    var raw = sessionStorage.getItem(key);
    if (!raw) return null;
    var p = JSON.parse(raw);
    if (Date.now() - (p._ts || 0) > _EXPLORE_CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return p;
  } catch(e) { return null; }
}
function _ssSetExplore_(key, data) {
  try { data._ts = Date.now(); sessionStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
}
function _ssClearExplore_() {
  try {
    ['exploreInfoCache','exploreFasumCache','exploreLaporCache','exploreWargaBaruCache'].forEach(function(k) {
      sessionStorage.removeItem(k);
    });
  } catch(e) {}
}

function loadAdminInfoPreview() {
  var el = document.getElementById('adminInfoPreviewList');
  if (!el) return;
  if (_infoCRUDCache) { renderAdminInfoPreview_(_infoCRUDCache); return; }
  // Try sessionStorage
  var cached = _ssGetExplore_('exploreInfoCache');
  if (cached) { _infoCRUDCache = cached; renderAdminInfoPreview_(cached); return; }
  el.innerHTML = '<div class="space-y-2 py-1">' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-3/4"></div>' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-1/2"></div>' +
    '</div>';
  gasGet_('adminGetInfoData')
    .then(function(res) { _infoCRUDCache = res; _ssSetExplore_('exploreInfoCache', res); renderAdminInfoPreview_(res); })
    .catch(function() {});
}

function renderAdminInfoPreview_(res) {
  var el = document.getElementById('adminInfoPreviewList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-1">Belum ada info.</p>';
    return;
  }
  el.innerHTML = res.data.slice(0, 3).map(function(d) {
    return '<div class="flex items-center justify-between py-1.5">' +
      '<span class="text-xs text-gray-700 truncate flex-1 pr-2">' + d.judul + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full ' + (d.aktif ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400') + ' font-medium flex-shrink-0">' +
      (d.aktif ? 'Aktif' : 'Nonaktif') + '</span>' +
    '</div>';
  }).join('') + (res.data.length > 3 ? '<p class="text-xs text-gray-400 pt-1">+' + (res.data.length - 3) + ' lainnya</p>' : '');
}

function renderAdminFasumPreview_(res) {
  var el = document.getElementById('adminFasumPreviewList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-1">Belum ada fasum.</p>';
    return;
  }
  // Update scorecard
  var issues = res.data.filter(function(d) { return d.status.toLowerCase() !== 'normal'; }).length;
  var scIssue = document.getElementById('scAdminFasumIssue');
  var scTotal = document.getElementById('scAdminFasumTotal');
  if (scIssue) scIssue.textContent = issues;
  if (scTotal) scTotal.textContent = '/ ' + res.data.length;
  var STATUS_COLOR = { normal: 'bg-blue-50 text-blue-600', maintenance: 'bg-yellow-50 text-yellow-600' };
  el.innerHTML = res.data.slice(0, 3).map(function(d) {
    var color = STATUS_COLOR[d.status.toLowerCase()] || 'bg-red-50 text-red-500';
    return '<div class="flex items-center justify-between py-1">' +
      '<span class="text-xs text-gray-700 truncate flex-1 pr-2">' + d.nama + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full ' + color + ' font-medium flex-shrink-0">' + d.status + '</span>' +
    '</div>';
  }).join('') + (res.data.length > 3 ? '<p class="text-[10px] text-gray-400 pt-1">+' + (res.data.length - 3) + ' lainnya</p>' : '');
}

function loadAdminFasumPreview() {
  var el = document.getElementById('adminFasumPreviewList');
  if (!el) return;
  if (_fasumCRUDCache) { renderAdminFasumPreview_(_fasumCRUDCache); return; }
  // Try sessionStorage
  var cached = _ssGetExplore_('exploreFasumCache');
  if (cached) { _fasumCRUDCache = cached; renderAdminFasumPreview_(cached); return; }
  el.innerHTML = '<div class="space-y-2 py-1">' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-3/4"></div>' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-1/2"></div>' +
    '</div>';
  gasGet_('adminGetFasumData')
    .then(function(res) { _fasumCRUDCache = res; _ssSetExplore_('exploreFasumCache', res); renderAdminFasumPreview_(res); })
    .catch(function() {});
}

// ===== INFO CRUD =====
function openInfoCRUD() {
  var modal = document.getElementById('infoCRUDModal');
  modal.classList.remove('hidden');
  renderInfoCRUDList(_infoCRUDCache);
  if (!_infoCRUDCache) {
    gasGet_('adminGetInfoData')
      .then(function(res) { _infoCRUDCache = res; renderInfoCRUDList(res); })
      .catch(function() {});
  }
}

function closeInfoCRUD() {
  document.getElementById('infoCRUDModal').classList.add('hidden');
}

var _infoDataMap = {};
var _fasumDataMap = {};

function renderInfoCRUDList(res) {
  var el = document.getElementById('infoCRUDList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada info. Tap + Tambah untuk mulai.</p>';
    return;
  }
  _infoDataMap = {};
  res.data.forEach(function(d) { _infoDataMap[d.rowNumber] = d; });

  el.innerHTML = res.data.map(function(d) {
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-start justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 mb-0.5">' +
          '<span class="text-sm font-semibold text-gray-900 truncate">' + d.judul + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ' + (d.aktif ? 'bg-blue-50 text-blue-600' : 'bg-gray-200 text-gray-400') + ' font-medium">' + (d.aktif ? 'Aktif' : 'Nonaktif') + '</span>' +
        '</div>' +
        '<span class="text-[11px] text-gray-400">' + d.kategori + ' · ' + (d.tanggal || '') + '</span>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openInfoFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteInfoConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openInfoFormByRow(rowNumber) {
  var d = _infoDataMap[rowNumber];
  if (!d) return;
  openInfoForm(d);
}

function openFasumFormByRow(rowNumber) {
  var d = _fasumDataMap[rowNumber];
  if (!d) return;
  openFasumForm(d);
}

// Ganti confirm() dengan modal — confirm() diblokir di GAS sandbox
var _pendingDeleteFn = null;

function showDeleteConfirm(message, onConfirm) {
  var modal = document.getElementById('deleteConfirmModal');
  var msgEl = document.getElementById('deleteConfirmMsg');
  if (!modal || !msgEl) {
    // fallback jika modal belum ada
    onConfirm();
    return;
  }
  msgEl.innerText = message;
  _pendingDeleteFn = onConfirm;
  modal.classList.remove('hidden');
}

function closeDeleteConfirm() {
  var modal = document.getElementById('deleteConfirmModal');
  if (modal) modal.classList.add('hidden');
  _pendingDeleteFn = null;

  // Reset tombol ke state awal
  var hapusBtn = document.querySelector('#deleteConfirmModal button:last-child');
  var batalBtn = document.querySelector('#deleteConfirmModal button:first-child');
  if (hapusBtn) {
    hapusBtn.disabled = false;
    hapusBtn.innerHTML = 'Hapus';
  }
  if (batalBtn) batalBtn.disabled = false;
}

function confirmDeleteAction() {
  var fn = _pendingDeleteFn;
  if (typeof fn !== 'function') return;

  // Spinner di modal
  var hapusBtn = document.querySelector('#deleteConfirmModal button:last-child');
  var batalBtn = document.querySelector('#deleteConfirmModal button:first-child');
  if (hapusBtn) {
    hapusBtn.disabled = true;
    hapusBtn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
      '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
      '<path d="M12 2a10 10 0 0 1 10 10"/>' +
      '</svg>Menghapus...</span>';
  }
  if (batalBtn) batalBtn.disabled = true;

  _pendingDeleteFn = null;
  fn();
}

function deleteInfoConfirm(rowNumber) {
  showDeleteConfirm('Hapus info ini?', function() { deleteInfo(rowNumber); });
}

function deleteFasumConfirm(rowNumber) {
  showDeleteConfirm('Hapus fasum ini?', function() { deleteFasum(rowNumber); });
}

function openInfoForm(data) {
  document.getElementById('infoFormModal').classList.remove('hidden');
  document.getElementById('infoFormTitle').innerText = data ? 'Edit Info' : 'Tambah Info';
  document.getElementById('infoFormRow').value = data ? data.rowNumber : '';
  document.getElementById('infoFormJudul').value = data ? data.judul : '';
  document.getElementById('infoFormKonten').value = data ? data.konten : '';
  document.getElementById('infoFormKategori').value = data ? data.kategori : 'Pengumuman';
  document.getElementById('infoFormTanggal').value = data ? data.tanggal : new Date().toISOString().split('T')[0];
  document.getElementById('infoFormAktif').checked = data ? data.aktif : true;
}

function closeInfoForm() {
  document.getElementById('infoFormModal').classList.add('hidden');
}

function saveInfoForm() {
  var btn = document.getElementById('infoFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
    '<path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';
  var payload = {
    rowNumber: parseInt(document.getElementById('infoFormRow').value) || null,
    judul    : document.getElementById('infoFormJudul').value.trim(),
    konten   : document.getElementById('infoFormKonten').value.trim(),
    kategori : document.getElementById('infoFormKategori').value,
    tanggal  : document.getElementById('infoFormTanggal').value,
    aktif    : document.getElementById('infoFormAktif').checked
  };
  gasPost_('adminSaveInfo', { payload: payload })
    .then(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      closeInfoForm();
      _infoCRUDCache = null;
      sessionStorage.removeItem('exploreInfoCache');
      gasGet_('adminGetInfoData')
        .then(function(res) {
          _infoCRUDCache = res;
          _ssSetExplore_('exploreInfoCache', res);
          renderInfoCRUDList(res);
          loadAdminInfoPreview();
          homeDataCache.info = null;
        });
      showToast('Info berhasil disimpan', 'success');
    })
    .catch(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      showToast('Gagal menyimpan', 'error');
    });
}

function deleteInfo(rowNumber) {
  gasPost_('adminDeleteInfo', { rowNumber: rowNumber })
      .then(function(res) {
        if (!res || !res.ok) { showToast('Gagal menghapus info', 'error'); return; }
        closeDeleteConfirm();
        showToast('Info dihapus', 'success');
        _infoCRUDCache = null;
        homeDataCache.info = null;
        sessionStorage.removeItem('exploreInfoCache');
        gasGet_('adminGetInfoData')
          .then(function(res2) {
            _infoCRUDCache = res2;
            _ssSetExplore_('exploreInfoCache', res2);
            renderInfoCRUDList(res2);
            loadAdminInfoPreview();
          });
      })
      .catch(function() {
        closeDeleteConfirm();
        showToast('Gagal menghapus ...', 'error');
      });
}

// ===== FASUM CRUD =====
function openFasumCRUD() {
  var modal = document.getElementById('fasumCRUDModal');
  modal.classList.remove('hidden');
  renderFasumCRUDList(_fasumCRUDCache);
  if (!_fasumCRUDCache) {
    gasGet_('adminGetFasumData')
      .then(function(res) { _fasumCRUDCache = res; renderFasumCRUDList(res); })
      .catch(function() {});
  }
}

function closeFasumCRUD() {
  document.getElementById('fasumCRUDModal').classList.add('hidden');
}

function renderFasumCRUDList(res) {
  var el = document.getElementById('fasumCRUDList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada fasum.</p>';
    return;
  }
  _fasumDataMap = {};
  res.data.forEach(function(d) { _fasumDataMap[d.rowNumber] = d; });

  var STATUS_COLOR = {
    'normal'     : 'bg-blue-50 text-blue-600',
    'maintenance': 'bg-yellow-50 text-yellow-600'
  };
  el.innerHTML = res.data.map(function(d) {
    var color = STATUS_COLOR[d.status.toLowerCase()] || 'bg-red-50 text-red-500';
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-sm font-semibold text-gray-900">' + d.nama + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ' + color + ' font-medium">' + d.status + '</span>' +
        '</div>' +
        '<span class="text-[11px] text-gray-400">' + (d.deskripsi || '') + '</span>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openFasumFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteFasumConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openFasumForm(data) {
  document.getElementById('fasumFormModal').classList.remove('hidden');
  document.getElementById('fasumFormTitle').innerText = data ? 'Edit Fasum' : 'Tambah Fasum';
  document.getElementById('fasumFormRow').value = data ? data.rowNumber : '';
  document.getElementById('fasumFormNama').value = data ? data.nama : '';
  document.getElementById('fasumFormDeskripsi').value = data ? data.deskripsi : '';
  document.getElementById('fasumFormStatus').value = data ? data.status : 'Normal';
  document.getElementById('fasumFormIcon').value = data ? data.icon : 'gate';
}

function closeFasumForm() {
  document.getElementById('fasumFormModal').classList.add('hidden');
}

function saveFasumForm() {
  var btn = document.getElementById('fasumFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
    '<path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';
  var rowNumber = parseInt(document.getElementById('fasumFormRow').value) || null;
  var payload = {
    rowNumber : rowNumber,
    nama      : document.getElementById('fasumFormNama').value.trim(),
    deskripsi : document.getElementById('fasumFormDeskripsi').value.trim(),
    status    : document.getElementById('fasumFormStatus').value,
    icon      : document.getElementById('fasumFormIcon').value
  };
  var gasAction = rowNumber ? 'adminSaveFasum' : 'adminAddFasum';
    gasPost_(gasAction, { payload: payload })
      .then(function() {
        btn.disabled = false;
        btn.innerText = 'Simpan';
        closeFasumForm();
        _fasumCRUDCache = null;
        sessionStorage.removeItem('exploreFasumCache');
        gasGet_('adminGetFasumData')
          .then(function(res) {
            _fasumCRUDCache = res;
            _ssSetExplore_('exploreFasumCache', res);
            renderFasumCRUDList(res);
            loadAdminFasumPreview();
            homeDataCache.fasum = null;
            loadHomeFasum();
          });
        showToast('Fasum berhasil disimpan', 'success');
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerText = 'Simpan';
        showToast('Gagal menyimpan', 'error');
      });
  }

function deleteFasum(rowNumber) {
  gasPost_('adminDeleteFasum', { rowNumber: rowNumber })
    .then(function(res) {
      if (!res || !res.ok) { showToast('Gagal menghapus fasum', 'error'); return; }
      closeDeleteConfirm();
      showToast('Fasum dihapus', 'success');
      _fasumCRUDCache = null;
      homeDataCache.fasum = null;
      sessionStorage.removeItem('exploreFasumCache');
      gasGet_('adminGetFasumData')
        .then(function(res2) {
          _fasumCRUDCache = res2;
          _ssSetExplore_('exploreFasumCache', res2);
          renderFasumCRUDList(res2);
          loadAdminFasumPreview();
          loadHomeFasum();
        });
    })
    .catch(function() {
      closeDeleteConfirm();
      showToast('Gagal menghapus ...', 'error');
    });
}

/* ============================================================
   ADMIN CRUD: DATA WARGA
   ============================================================ */
var _dataWargaCache = null;
var _dataWargaMap   = {};
var _dataWargaFiltered = [];

function openDataWargaCRUD() {
  var modal = document.getElementById('dataWargaCRUDModal');
  modal.classList.remove('hidden');
  var searchEl = document.getElementById('dataWargaSearch');
  if (searchEl) searchEl.value = '';
  if (_dataWargaCache) {
    renderDataWargaList(_dataWargaCache);
  } else {
    _showDataWargaLoading_();
    gasGet_('adminGetDataWarga')
      .then(function(res) { _dataWargaCache = res; renderDataWargaList(res); })
      .catch(function() {
        var el = document.getElementById('dataWargaCRUDList');
        if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data. Coba lagi.</p>';
      });
  }
}

function _showDataWargaLoading_() {
  var el = document.getElementById('dataWargaCRUDList');
  if (!el) return;
  el.innerHTML = '<div class="space-y-2 py-1">' + '<div class="skeleton rounded-2xl" style="height:62px"></div>'.repeat(5) + '</div>';
}

function closeDataWargaCRUD() {
  document.getElementById('dataWargaCRUDModal').classList.add('hidden');
}

function renderDataWargaList(res, filtered) {
  var el = document.getElementById('dataWargaCRUDList');
  if (!el) return;
  var list = filtered || (res && res.data) || [];
  if (!res || !res.ok) {
    el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data.</p>';
    return;
  }
  if (!list.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Tidak ada data warga.</p>';
    return;
  }
  _dataWargaMap = {};
  (res.data || []).forEach(function(d) { _dataWargaMap[d.rowNumber] = d; });
  el.innerHTML = list.map(function(d) {
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-center gap-3">' +
      '<div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-black text-sm" style="background:' + _avatarColors_[d.blok.charCodeAt(0) % _avatarColors_.length] + '">' +
        d.blok.charAt(0) +
      '</div>' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-1.5">' +
          '<p class="text-sm font-bold text-gray-900 truncate">' + d.blok + ' · ' + (d.nama || '—') + '</p>' +
          (d.role === 'admin' ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 flex-shrink-0">ADMIN</span>' : '') +
        '</div>' +
        '<p class="text-[11px] text-gray-400 truncate">' + (d.email || '—') + '</p>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openRiwayatPenghuni(\'' + d.blok + '\')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
        '</button>' +
        '<button onclick="openDataWargaFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteDataWargaConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filterDataWargaList() {
  var kw = (document.getElementById('dataWargaSearch')?.value || '').toLowerCase().trim();
  if (!_dataWargaCache || !_dataWargaCache.data) return;
  var filtered = kw
    ? _dataWargaCache.data.filter(function(d) {
        return (d.blok + ' ' + d.nama + ' ' + d.email).toLowerCase().indexOf(kw) !== -1;
      })
    : _dataWargaCache.data;
  renderDataWargaList(_dataWargaCache, filtered);
}

// ===== RIWAYAT PENGHUNI (admin) =====

function openRiwayatPenghuni(blok) {
  var modal = document.getElementById('riwayatPenghuniModal');
  var label = document.getElementById('riwayatPenghuniBlokLabel');
  var list  = document.getElementById('riwayatPenghuniList');
  if (!modal || !list) return;
  if (label) label.textContent = 'Blok ' + blok;
  modal.classList.remove('hidden');
  list.innerHTML = '<div class="space-y-2 py-1">' + '<div class="skeleton rounded-2xl" style="height:56px"></div>'.repeat(3) + '</div>';

  gasGet_('getRiwayatPenghuni', { blok: blok, email: currentUser.email })
    .then(function(res) { renderRiwayatPenghuniList(res); })
    .catch(function() {
      list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat riwayat.</p>';
    });
}

function closeRiwayatPenghuniModal() {
  var modal = document.getElementById('riwayatPenghuniModal');
  if (modal) modal.classList.add('hidden');
}

function renderRiwayatPenghuniList(res) {
  var list = document.getElementById('riwayatPenghuniList');
  if (!list) return;
  if (!res || !res.ok) {
    list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat riwayat.</p>';
    return;
  }
  var data = res.data || [];
  if (!data.length) {
    list.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada riwayat penghuni untuk blok ini.</p>';
    return;
  }
  list.innerHTML = data.map(function(r) {
    var statusBadge = r.status === 'Pemilik'
      ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">PEMILIK</span>'
      : (r.status === 'Penyewa'
        ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">PENYEWA</span>'
        : '');
    var aktifBadge = r.aktif
      ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">AKTIF</span>'
      : '';
    var periode = r.tanggalMulai + ' – ' + (r.aktif ? 'Sekarang' : (r.tanggalSelesai || '-'));
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 ' + (r.aktif ? 'border-l-4 border-primary' : '') + '">' +
      '<div class="flex items-center justify-between gap-2">' +
        '<p class="text-sm font-bold text-gray-900 truncate">' + (r.nama || '-') + '</p>' +
        '<div class="flex gap-1 flex-shrink-0">' + aktifBadge + statusBadge + '</div>' +
      '</div>' +
      '<p class="text-[11px] text-gray-400 mt-0.5">' + periode + '</p>' +
      (r.noHp ? '<p class="text-[11px] text-gray-400">' + r.noHp + (r.email ? ' · ' + r.email : '') + '</p>' : '') +
      (r.keterangan ? '<p class="text-[10px] text-gray-300 mt-1">' + r.keterangan + '</p>' : '') +
    '</div>';
  }).join('');
}

function openDataWargaFormByRow(rowNumber) {
  var d = _dataWargaMap[rowNumber];
  if (!d) return;
  openDataWargaForm(d);
}

function openDataWargaForm(data) {
  document.getElementById('dataWargaFormModal').classList.remove('hidden');
  document.getElementById('dataWargaFormTitle').innerText = data ? 'Edit Warga' : 'Tambah Warga';
  document.getElementById('dataWargaFormRow').value   = data ? data.rowNumber : '';
  document.getElementById('dataWargaFormBlok').value  = data ? data.blok  : '';
  document.getElementById('dataWargaFormNama').value  = data ? data.nama  : '';
  document.getElementById('dataWargaFormHp').value    = data ? data.noHp  : '';
  document.getElementById('dataWargaFormEmail').value = data ? data.email : '';
  var roleEl = document.getElementById('dataWargaFormRole');
  if (roleEl) {
    var _r = (data && data.role) ? String(data.role).toLowerCase() : 'warga';
    roleEl.value = (['admin','pengurus','bendahara','warga'].indexOf(_r) > -1) ? _r : 'warga';
  }

  // ===== Pengaturan IPL (dari sheet IPL tahun berjalan) =====
  var ipl = (data && data.ipl) ? data.ipl : {};
  _iplFormYear_ = ipl.year || new Date().getFullYear();

  var statusEl = document.getElementById('dataWargaFormStatus');
  if (statusEl) statusEl.value = ipl.status || '';

  _iplSetRupiah_('dataWargaFormNominal', ipl.iplWajib);
  _iplSetRupiah_('dataWargaFormTarifA',  ipl.tarif175);
  _iplSetRupiah_('dataWargaFormTarifB',  ipl.tarif200);

  // Dropdown bulan (tahun otomatis = tahun sheet)
  _iplFillMonthSelect_('dataWargaFormStartA', ipl.start175);
  _iplFillMonthSelect_('dataWargaFormEndA',   ipl.end175);
  _iplFillMonthSelect_('dataWargaFormStartB', ipl.start200);
  _iplFillMonthSelect_('dataWargaFormEndB',   ipl.end200);

  var yrEl = document.getElementById('dataWargaFormIplYear');
  if (yrEl) yrEl.textContent = 'IPL-' + _iplFormYear_;
  var yrInline = document.getElementById('dataWargaFormIplYearInline');
  if (yrInline) yrInline.textContent = _iplFormYear_;
}

// ===== Helper IPL: nominal Rupiah & dropdown bulan =====
var _iplFormYear_ = new Date().getFullYear();
var _IPL_MONTHS_ = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Map token bulan (ID/EN) → singkatan EN kanonik
function _iplCanonMonth_(str) {
  var s = String(str || '').trim().toLowerCase();
  var m = s.match(/([a-z]+)/);
  if (!m) return '';
  var t = m[1].slice(0, 3);
  var MAP = { jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',mei:'May',jun:'Jun',
              jul:'Jul',aug:'Aug',agu:'Aug',agt:'Aug',sep:'Sep',oct:'Oct',okt:'Oct',
              nov:'Nov',dec:'Dec',des:'Dec' };
  return MAP[t] || '';
}

// Isi <select> bulan, preselect dari nilai tersimpan ("May 2026" / "Mei 2026")
function _iplFillMonthSelect_(id, storedVal) {
  var el = document.getElementById(id);
  if (!el) return;
  var sel = _iplCanonMonth_(storedVal);
  var html = '<option value="">— bulan —</option>';
  _IPL_MONTHS_.forEach(function(mo) {
    html += '<option value="' + mo + '"' + (mo === sel ? ' selected' : '') + '>' + mo + '</option>';
  });
  el.innerHTML = html;
}

// Set input nominal jadi format "Rp X.XXX" dari angka
function _iplSetRupiah_(id, val) {
  var el = document.getElementById(id);
  if (!el) return;
  var digits = String(val == null ? '' : val).replace(/[^\d]/g, '');
  el.value = digits ? ('Rp ' + Number(digits).toLocaleString('id-ID')) : '';
}

// Handler oninput: terima angka saja, format Rp, tampilkan hint kalau ada karakter non-angka
function _iplRupiahInput_(el) {
  if (!el) return;
  var raw = el.value;
  var hadInvalid = /[^\d\s.Rp]/i.test(raw) || /[a-zA-Z]/.test(raw.replace(/^Rp/i, ''));
  var digits = raw.replace(/[^\d]/g, '');
  el.value = digits ? ('Rp ' + Number(digits).toLocaleString('id-ID')) : '';
  var hint = document.getElementById(el.id + 'Hint');
  if (hint) {
    if (hadInvalid) { hint.classList.remove('hidden'); setTimeout(function(){ hint.classList.add('hidden'); }, 2000); }
    else hint.classList.add('hidden');
  }
}

// Ambil angka murni dari field rupiah
function _iplNumVal_(id) {
  var el = document.getElementById(id);
  if (!el) return '';
  var d = el.value.replace(/[^\d]/g, '');
  return d || '';
}

// Bangun string periode "Mon YEAR" dari dropdown bulan + tahun form
function _iplPeriodVal_(id) {
  var el = document.getElementById(id);
  if (!el || !el.value) return '';
  return el.value + ' ' + _iplFormYear_;
}

function closeDataWargaForm() {
  document.getElementById('dataWargaFormModal').classList.add('hidden');
}

function saveDataWargaForm() {
  var blok = document.getElementById('dataWargaFormBlok').value.trim().toUpperCase();
  var nama = document.getElementById('dataWargaFormNama').value.trim();
  if (!blok || !nama) { showToast('Blok dan Nama wajib diisi', 'error'); return; }

  var btn = document.getElementById('dataWargaFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';

  var roleEl = document.getElementById('dataWargaFormRole');
  var payload = {
    rowNumber : parseInt(document.getElementById('dataWargaFormRow').value) || null,
    blok  : blok,
    nama  : nama,
    noHp  : document.getElementById('dataWargaFormHp').value.trim(),
    email : document.getElementById('dataWargaFormEmail').value.trim().toLowerCase(),
    role  : roleEl ? roleEl.value : 'warga',
    adminEmail : currentUser ? currentUser.email : '',
    ipl : {
      status   : (document.getElementById('dataWargaFormStatus') || {}).value || '',
      iplWajib : _iplNumVal_('dataWargaFormNominal'),
      tarif175 : _iplNumVal_('dataWargaFormTarifA'),
      start175 : _iplPeriodVal_('dataWargaFormStartA'),
      end175   : _iplPeriodVal_('dataWargaFormEndA'),
      tarif200 : _iplNumVal_('dataWargaFormTarifB'),
      start200 : _iplPeriodVal_('dataWargaFormStartB'),
      end200   : _iplPeriodVal_('dataWargaFormEndB')
    }
  };

  gasPost_('adminSaveDataWarga', { payload: payload })
    .then(function() {
      btn.disabled = false; btn.innerText = 'Simpan';
      closeDataWargaForm();
      _dataWargaCache = null;
      gasGet_('adminGetDataWarga').then(function(res) {
        _dataWargaCache = res;
        renderDataWargaList(res);
        loadAdminWargaPreview();
      });
      showToast('Data warga disimpan', 'success');
    })
    .catch(function() {
      btn.disabled = false; btn.innerText = 'Simpan';
      showToast('Gagal menyimpan', 'error');
    });
}

function deleteDataWargaConfirm(rowNumber) {
  var d = _dataWargaMap[rowNumber];
  var label = d ? (d.blok + ' · ' + d.nama) : 'warga ini';
  showDeleteConfirm('Hapus ' + label + '?', function() { deleteDataWarga(rowNumber); });
}

function deleteDataWarga(rowNumber) {
  gasPost_('adminDeleteDataWarga', { rowNumber: rowNumber })
    .then(function(res) {
      if (!res || !res.ok) { showToast('Gagal menghapus', 'error'); return; }
      closeDeleteConfirm();
      showToast('Data warga dihapus', 'success');
      _dataWargaCache = null;
      gasGet_('adminGetDataWarga').then(function(res2) {
        _dataWargaCache = res2;
        renderDataWargaList(res2);
        loadAdminWargaPreview();
      });
    })
    .catch(function() { closeDeleteConfirm(); showToast('Gagal menghapus', 'error'); });
}

function loadAdminWargaPreview() {
  var el = document.getElementById('adminWargaPreviewList');
  if (!el) return;
  gasGet_('adminGetDataWarga').then(function(res) {
    if (!res || !res.ok || !res.data || !res.data.length) {
      el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada data</p>';
      return;
    }
    var total = res.data.length;
    // Update scorecard
    var sc = document.getElementById('scAdminWarga');
    if (sc) sc.textContent = total;
    // Group by first letter of blok (A/B/C/D)
    var groups = {};
    res.data.forEach(function(d) { var k = d.blok.charAt(0); groups[k] = (groups[k]||0)+1; });
    var groupStr = Object.keys(groups).sort().map(function(k){ return 'Blok '+k+' ('+groups[k]+')'; }).join(' · ');
    el.innerHTML = '<p class="text-xs text-gray-500 font-medium">' + total + ' warga terdaftar</p>' +
      '<p class="text-[10px] text-gray-400 mt-0.5 leading-relaxed">' + groupStr + '</p>';
  }).catch(function() {
    el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
  });
}

/* ============================================================
   ADMIN CRUD: GREETING
   ============================================================ */
var _greetingCRUDCache = null;
var _greetingDataMap = {};

function openGreetingCRUD() {
  var modal = document.getElementById('greetingCRUDModal');
  modal.classList.remove('hidden');
  if (_greetingCRUDCache) {
    renderGreetingCRUDList(_greetingCRUDCache);
  } else {
    var el = document.getElementById('greetingCRUDList');
    if (el) el.innerHTML = '<div class="space-y-2 py-1">' + '<div class="skeleton rounded-2xl" style="height:62px"></div>'.repeat(5) + '</div>';
    gasGet_('adminGetGreetings')
      .then(function(res) { _greetingCRUDCache = res; renderGreetingCRUDList(res); })
      .catch(function() {
        if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat. Coba lagi.</p>';
      });
  }
}

function closeGreetingCRUD() {
  document.getElementById('greetingCRUDModal').classList.add('hidden');
}

function renderGreetingCRUDList(res) {
  var el = document.getElementById('greetingCRUDList');
  if (!el) return;
  if (!res || !res.ok || !res.data || !res.data.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada greeting. Tap + Tambah untuk mulai.</p>';
    return;
  }
  _greetingDataMap = {};
  res.data.forEach(function(d) { _greetingDataMap[d.rowNumber] = d; });
  el.innerHTML = res.data.map(function(d) {
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-start justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 mb-0.5">' +
          '<span class="text-sm font-semibold text-gray-900 truncate">' + (d.judul || d.teks || '') + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ' + (d.aktif ? 'bg-blue-50 text-blue-600' : 'bg-gray-200 text-gray-400') + ' font-medium">' + (d.aktif ? 'Aktif' : 'Nonaktif') + '</span>' +
        '</div>' +
        '<span class="text-[11px] text-gray-400">' + (d.mulai || '') + ' → ' + (d.stop || '') + '</span>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openGreetingFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteGreetingConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openGreetingFormByRow(rowNumber) {
  var d = _greetingDataMap[rowNumber];
  if (!d) return;
  openGreetingForm(d);
}

function openGreetingForm(data) {
  document.getElementById('greetingFormModal').classList.remove('hidden');
  document.getElementById('greetingFormTitle').innerText = data ? 'Edit Greeting' : 'Tambah Greeting';
  document.getElementById('greetingFormRow').value   = data ? data.rowNumber : '';
  document.getElementById('greetingFormJudul').value  = data ? (data.judul || '') : '';
  document.getElementById('greetingFormTeks').value   = data ? (data.konten || data.teks || '') : '';
  document.getElementById('greetingFormMulai').value  = data ? data.mulai : new Date().toISOString().split('T')[0];
  document.getElementById('greetingFormStop').value   = data ? data.stop  : new Date().toISOString().split('T')[0];
  document.getElementById('greetingFormAktif').checked = data ? data.aktif : true;
}

function closeGreetingForm() {
  document.getElementById('greetingFormModal').classList.add('hidden');
}

function saveGreetingForm() {
  var btn = document.getElementById('greetingFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
    '<path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';
  var payload = {
    rowNumber : parseInt(document.getElementById('greetingFormRow').value) || null,
    judul     : document.getElementById('greetingFormJudul').value.trim(),
    konten    : document.getElementById('greetingFormTeks').value.trim(),
    mulai     : document.getElementById('greetingFormMulai').value,
    stop      : document.getElementById('greetingFormStop').value,
    aktif     : document.getElementById('greetingFormAktif').checked
  };
  gasPost_('adminSaveGreeting', { payload: payload })
    .then(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      closeGreetingForm();
      _greetingCRUDCache = null;
      gasGet_('adminGetGreetings')
        .then(function(res) {
          _greetingCRUDCache = res;
          renderGreetingCRUDList(res);
          loadAdminGreetingPreview();
        });
      showToast('Greeting berhasil disimpan', 'success');
    })
    .catch(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      showToast('Gagal menyimpan', 'error');
    });
}

function deleteGreetingConfirm(rowNumber) {
  showDeleteConfirm('Hapus greeting ini?', function() { deleteGreeting(rowNumber); });
}

function deleteGreeting(rowNumber) {
  gasPost_('adminDeleteGreeting', { rowNumber: rowNumber })
    .then(function(res) {
      if (!res || !res.ok) { showToast('Gagal menghapus greeting', 'error'); return; }
      closeDeleteConfirm();
      showToast('Greeting dihapus', 'success');
      _greetingCRUDCache = null;
      gasGet_('adminGetGreetings')
        .then(function(res2) {
          _greetingCRUDCache = res2;
          renderGreetingCRUDList(res2);
          loadAdminGreetingPreview();
        });
    })
    .catch(function() {
      closeDeleteConfirm();
      showToast('Gagal menghapus', 'error');
    });
}

function loadAdminGreetingPreview() {
  var el = document.getElementById('adminGreetingPreviewList');
  if (!el) return;
  gasGet_('adminGetGreetings')
    .then(function(res) {
      if (!res || !res.ok || !res.data || !res.data.length) {
        el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada greeting</p>';
        return;
      }
      el.innerHTML = res.data.slice(0, 3).map(function(d) {
        return '<div class="flex items-center gap-2 py-1">' +
          '<span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ' + (d.aktif ? 'bg-blue-400' : 'bg-gray-300') + '"></span>' +
          '<span class="text-xs text-gray-700 truncate flex-1">' + (d.judul || d.konten || d.teks || '') + '</span>' +
          '<span class="text-[10px] text-gray-400 flex-shrink-0">' + (d.mulai || '') + '</span>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
    });
}

/* ============================================================
   FORM MUDIK
   ============================================================ */
function scrollToPedoman() {
  // Pedoman kini berupa popup modal — alihkan ke togglePedomanModal()
  if (typeof togglePedomanModal === 'function') togglePedomanModal();
}

function openFormMudik() {
  var el = document.getElementById('formMudik');
  if (!el) return;

  // Reset state
  document.getElementById('mudikAgree').checked = false;
  document.getElementById('mudikHpDarurat').value = '';
  document.getElementById('mudikTglPergi').value = '';
  document.getElementById('mudikTglKembali').value = '';
  document.getElementById('mudikNama').value = '';
  document.getElementById('mudikHp1').value = '';
  document.getElementById('mudikBlok').value = '';
  document.getElementById('mudikBlok').readOnly = false;
  document.getElementById('mudikBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');

  var ubahBtn = document.getElementById('mudikUbahBtn');

  if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
    // Sudah login → auto-fill + lock + tampil ubah
    var first = currentUser.wargaData[0];
    document.getElementById('mudikNama').value = first.nama || '';
    document.getElementById('mudikHp1').value  = first.noHp || '';
    document.getElementById('mudikBlok').value = currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
    document.getElementById('mudikBlok').readOnly = true;
    document.getElementById('mudikBlok').classList.add('bg-gray-100', 'cursor-not-allowed');
    document.getElementById('mudikNama').readOnly = true;
    document.getElementById('mudikHp1').readOnly  = true;
    if (ubahBtn) ubahBtn.classList.remove('hidden');
  } else {
    // Belum login → blok bisa diisi, nama & HP auto-fill setelah lookup
    document.getElementById('mudikNama').readOnly = true;
    document.getElementById('mudikHp1').readOnly  = true;
    if (ubahBtn) ubahBtn.classList.add('hidden');
  }

  updateMudikSubmitBtn();
  el.style.opacity = '1';
  el.style.pointerEvents = 'auto';
  history.pushState({ formMudik: true }, '');
  // Block sidebar navigation while form is open
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
}

function mudikEnableEdit() {
  if (!currentUser) {
    openLoginRequiredModal('Silakan login untuk mengubah data.');
    return;
  }
  document.getElementById('mudikBlok').readOnly = false;
  document.getElementById('mudikBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');
  document.getElementById('mudikBlok').focus();
  document.getElementById('mudikUbahBtn').classList.add('hidden');
}

var _mudikLookupTimer = null;
function onMudikBlokInput() {
  var val = document.getElementById('mudikBlok').value.trim().toUpperCase();
  document.getElementById('mudikBlok').value = val;
  updateMudikSubmitBtn();

  if (!val) {
    document.getElementById('mudikNama').value = '';
    document.getElementById('mudikHp1').value  = '';
    return;
  }

  // Debounce 800ms → auto lookup
  clearTimeout(_mudikLookupTimer);
  _mudikLookupTimer = setTimeout(function() {
    triggerMudikBlokLookup();
  }, 800);
}

function triggerMudikBlokLookup() {
  var val = document.getElementById('mudikBlok').value.trim().toUpperCase();
  if (!val) return;

  var loading = document.getElementById('mudikBlokLoading');
  if (loading) loading.classList.remove('hidden');

  gasGet_('getResidentByBlock', { blok: val })
    .then(function(res) {
      if (loading) loading.classList.add('hidden');
      if (!res || !res.found) {
        document.getElementById('mudikNama').value = '';
        document.getElementById('mudikHp1').value  = '';
        updateMudikSubmitBtn();
        return;
      }
      document.getElementById('mudikNama').value = res.nama || '';
      document.getElementById('mudikHp1').value  = res.noHp  || '';
      updateMudikSubmitBtn();
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
    });
}

function openFormRenovasi() {
  var el = document.getElementById('formRenovasi');
  if (!el) return;

  // Reset
  document.querySelectorAll('input[name="renovSetuju"]').forEach(function(r) { r.checked = false; });
  var alatBerat = document.querySelector('input[name="renovAlatBerat"][value="Tidak"]');
  if (alatBerat) alatBerat.checked = true;
  document.getElementById('renovTglMulai').value    = '';
  document.getElementById('renovTglSelesai').value  = '';
  document.getElementById('renovRincian').value     = '';
  document.getElementById('renovNamaMandor').value  = '';
  document.getElementById('renovJumlahPekerja').value = '';
  document.getElementById('renovNama').value = '';
  document.getElementById('renovBlok').value = '';
  document.getElementById('renovBlok').readOnly = false;
  document.getElementById('renovBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');
  removeRenovKtp();

  var ubahBtn = document.getElementById('renovUbahBtn');

  if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
    var first = currentUser.wargaData[0];
    document.getElementById('renovNama').value = first.nama || '';
    document.getElementById('renovBlok').value = currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
    document.getElementById('renovBlok').readOnly = true;
    document.getElementById('renovBlok').classList.add('bg-gray-100', 'cursor-not-allowed');
    document.getElementById('renovNama').readOnly = true;
    if (ubahBtn) ubahBtn.classList.remove('hidden');
  } else {
    document.getElementById('renovNama').readOnly = true;
    if (ubahBtn) ubahBtn.classList.add('hidden');
  }

  updateRenovSubmitBtn();
  el.style.opacity = '1';
  el.style.pointerEvents = 'auto';
  history.pushState({ formRenovasi: true }, '');
  // Block sidebar navigation while form is open
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
}

function renovEnableEdit() {
  if (!currentUser) {
    openLoginRequiredModal('Silakan login untuk mengubah data.');
    return;
  }
  document.getElementById('renovBlok').readOnly = false;
  document.getElementById('renovBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');
  document.getElementById('renovBlok').focus();
  document.getElementById('renovUbahBtn').classList.add('hidden');
}

function onRenovBlokInput() {
  var val = document.getElementById('renovBlok').value.trim().toUpperCase();
  document.getElementById('renovBlok').value = val;
  updateRenovSubmitBtn();
  if (!val) {
    document.getElementById('renovNama').value = '';
  }
}

function triggerRenovBlokLookup() {
  var val = document.getElementById('renovBlok').value.trim().toUpperCase();
  if (!val) return;

  var loading = document.getElementById('renovBlokLoading');
  if (loading) loading.classList.remove('hidden');

  gasGet_('getResidentByBlock', { blok: val })
    .then(function(res) {
      if (loading) loading.classList.add('hidden');
      if (!res || !res.found) return;
      document.getElementById('renovNama').value = res.nama || '';
      updateRenovSubmitBtn();
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
    });
}

function closeFormMudik() {
  var el = document.getElementById('formMudik');
  if (!el) return;
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.add('hidden'); document.body.style.overflow = ''; }
  if (history.state && history.state.formMudik) history.back();
}

function updateMudikSubmitBtn() {
  var btn      = document.getElementById('mudikSubmitBtn');
  var agree    = document.getElementById('mudikAgree')?.checked;
  var hpDarurat = (document.getElementById('mudikHpDarurat')?.value || '').trim();
  var tglPergi  = (document.getElementById('mudikTglPergi')?.value || '').trim();
  var tglKembali= (document.getElementById('mudikTglKembali')?.value || '').trim();

  var blokVal = (document.getElementById('mudikBlok')?.value || '').trim();
  if (btn) btn.disabled = !(agree && blokVal && hpDarurat && tglPergi && tglKembali);
}

function submitFormMudik() {
  var btn = document.getElementById('mudikSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerText = 'Mengirim...'; }

  var payload = {
    blok       : document.getElementById('mudikBlok')?.value || '',
    nama       : document.getElementById('mudikNama')?.value || '',
    noHp1      : document.getElementById('mudikHp1')?.value || '',
    noHpDarurat: document.getElementById('mudikHpDarurat')?.value || '',
    tglPergi   : document.getElementById('mudikTglPergi')?.value || '',
    tglKembali : document.getElementById('mudikTglKembali')?.value || '',
    setuju     : 'Ya'
  };

  gasPost_('submitFormMudik', { payload: payload })
    .then(function() {
      closeFormMudik();
      showToast('Konfirmasi mudik berhasil dikirim 🙏', 'success');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi'; }
    })
    .catch(function() {
      showToast('Gagal mengirim, coba lagi', 'error');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi'; }
    });
}

function closeFormRenovasi() {
  var el = document.getElementById('formRenovasi');
  if (!el) return;
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.add('hidden'); document.body.style.overflow = ''; }
  if (history.state && history.state.formRenovasi) history.back();
}

function renovHighlightAgreement() {
  var setuju = document.querySelector('input[name="renovSetuju"]:checked')?.value;
  var ya    = document.getElementById('renovSetujuYaLabel');
  var tidak = document.getElementById('renovSetujuTidakLabel');
  if (!ya || !tidak) return;
  if (setuju === 'Setuju') {
    ya.style.background    = '#FFF7ED'; ya.style.borderColor = '#EA580C';
    tidak.style.background = ''; tidak.style.borderColor = '#D1D5DB';
  } else if (setuju === 'Tidak Setuju') {
    tidak.style.background = '#FEF2F2'; tidak.style.borderColor = '#EF4444';
    ya.style.background    = ''; ya.style.borderColor = '#E5E7EB';
  }
}

function updateRenovSubmitBtn() {
  var btn      = document.getElementById('renovSubmitBtn');
  var setuju   = document.querySelector('input[name="renovSetuju"]:checked')?.value;
  var tglMulai = (document.getElementById('renovTglMulai')?.value || '').trim();
  var tglSelesai=(document.getElementById('renovTglSelesai')?.value || '').trim();
  var rincian  = (document.getElementById('renovRincian')?.value || '').trim();
  var mandor   = (document.getElementById('renovNamaMandor')?.value || '').trim();
  var ktp      = (document.getElementById('renovKtpMandor')?.value || '').trim();
  var jumlah   = (document.getElementById('renovJumlahPekerja')?.value || '').trim();

  // Submit hanya aktif jika setuju = 'Setuju' dan semua field terisi
  var ktpOk = (typeof renovKtpFileUrl !== 'undefined' && renovKtpFileUrl) ? true : false;
  var valid = setuju === 'Setuju' && tglMulai && tglSelesai && rincian && mandor && ktpOk && jumlah;
  if (btn) btn.disabled = !valid;
}

var renovKtpFileUrl = null;

function handleRenovKtpUpload(input) {
  var file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast('Ukuran file maksimal 5MB', 'error');
    return;
  }

  var filenameEl = document.getElementById('renovKtpFilename');
  if (filenameEl) {
    filenameEl.innerHTML =
      '<span class="flex items-center gap-2">' +
        '<svg class="w-4 h-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">' +
          '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.3"/>' +
          '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3"/>' +
        '</svg>' +
        '<span class="text-sm text-gray-500">Mengupload foto KTP...</span>' +
      '</span>';
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result.split(',')[1];
    var meta = {
      blok: document.getElementById('renovBlok')?.value || '',
      periode: 'KTP-Mandor',
      nama: document.getElementById('renovNamaMandor')?.value || 'Mandor'
    };

    gasPost_('uploadBuktiTransfer', {
      base64: base64,
      filename: file.name,
      mimeType: file.type,
      meta: meta
    })
      .then(function(res) {
        renovKtpFileUrl = res.url;
        if (filenameEl) {
          filenameEl.innerHTML = '<span class="flex items-center gap-2 text-blue-600"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg><span class="text-sm font-medium">' + file.name + '</span></span>';
        }
        var preview = document.getElementById('renovKtpPreview');
        var img = document.getElementById('renovKtpImg');
        var pdf = document.getElementById('renovKtpPdf');
        var pdfName = document.getElementById('renovKtpPdfName');
        preview.classList.remove('hidden');
        if (file.type.startsWith('image/')) {
          img.src = URL.createObjectURL(file);
          img.classList.remove('hidden');
          if (pdf) pdf.classList.add('hidden');
        } else {
          if (pdfName) pdfName.innerText = file.name;
          if (pdf) pdf.classList.remove('hidden');
          img.classList.add('hidden');
        }
        updateRenovSubmitBtn();
      })
      .catch(function() {
        renovKtpFileUrl = null;
        if (filenameEl) {
          filenameEl.innerHTML = '<span class="flex items-center gap-2 text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg><span class="text-sm">Upload gagal, coba lagi</span></span>';
        }
        showToast('Upload KTP gagal', 'error');
        updateRenovSubmitBtn();
      });
  };
  reader.readAsDataURL(file);
}

function removeRenovKtp() {
  renovKtpFileUrl = null;
  document.getElementById('renovKtpUpload').value = '';
  document.getElementById('renovKtpFilename').innerText = 'Ambil foto atau pilih dari galeri';
  document.getElementById('renovKtpPreview').classList.add('hidden');
  document.getElementById('renovKtpImg').src = '';
  document.getElementById('renovKtpImg').classList.add('hidden');
  updateRenovSubmitBtn();
}

function submitFormRenovasi() {
  var btn = document.getElementById('renovSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerText = 'Mengirim...'; }

  var alatBerat = document.querySelector('input[name="renovAlatBerat"]:checked')?.value || 'Tidak';

  var payload = {
    blok        : document.getElementById('renovBlok')?.value || '',
    nama        : document.getElementById('renovNama')?.value || '',
    tglMulai    : document.getElementById('renovTglMulai')?.value || '',
    tglSelesai  : document.getElementById('renovTglSelesai')?.value || '',
    setuju      : document.querySelector('input[name="renovSetuju"]:checked')?.value || '',
    rincian     : document.getElementById('renovRincian')?.value || '',
    alatBerat   : alatBerat,
    namaMandor  : document.getElementById('renovNamaMandor')?.value || '',
    ktpMandor   : renovKtpFileUrl || '',
    jumlahPekerja: document.getElementById('renovJumlahPekerja')?.value || ''
  };

  gasPost_('submitFormRenovasi', { payload: payload })
    .then(function() {
      closeFormRenovasi();
      showToast('Konfirmasi renovasi berhasil dikirim 🙏', 'success');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi Renovasi'; }
    })
    .catch(function() {
      showToast('Gagal mengirim, coba lagi', 'error');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi Renovasi'; }
    });
}

/* ============================================================
   PEDOMAN VIEWER
   ============================================================ */
var _pedomanTitles = {
  '1Lh5hBOSZWwY9mhFob9ESY-s0FnYZ8cEO': 'Pedoman dan Tata Tertib',
  '1R5Z6HvpanZPrPjKUgZkSm9-mpbCOeZhh': 'Hewan Peliharaan',
  '1tHlGGS4N0Ifdme576zbvDLbt9z64Mprt': 'Batas Kecepatan & Lokasi Parkir',
  '1jjFWxgbabwZgov9aQI8CM35tgCMQW13K': 'Struktur Organisasi'
};

function openPedomanViewer(fileId, judul) {
  if (!currentUser) {
    openMePage();
    return;
  }
  var modal = document.getElementById('pedomanViewer');
  var frame = document.getElementById('pedomanViewerFrame');
  var title = document.getElementById('pedomanViewerTitle');

  if (!modal || !frame) return;

  frame.src = 'https://drive.google.com/file/d/' + fileId + '/preview';
  if (title) title.innerText = judul || _pedomanTitles[fileId] || 'Dokumen';

  modal.classList.remove('hidden');
  history.pushState({ pedomanViewer: true }, '');
}

function closePedomanViewer() {
  var modal = document.getElementById('pedomanViewer');
  var frame = document.getElementById('pedomanViewerFrame');
  if (!modal) return;
  frame.src = 'about:blank';
  frame.style.display = '';
  var banner = document.getElementById('kasIplFallbackBanner');
  if (banner) banner.remove();
  var backBtn = document.getElementById('kasBackBtn');
  if (backBtn) backBtn.remove();
  var dlBtn = document.getElementById('kasDownloadBtn');
  if (dlBtn) dlBtn.remove();
  modal.classList.add('hidden');
}

// ===== PAYMENT BANNER HELPERS =====
function showPaymentSuccessBanner(opts) {
  var o = opts || {};
  var nama = o.nama || 'Warga';
  var blokRaw = o.blok || '';
  var blokLabel = blokRaw ? nama + ' (' + blokRaw + ')' : nama;
  document.getElementById('bannerNamaBlok').textContent = blokLabel;
  document.getElementById('bannerPeriode').textContent = o.periode || '-';
  document.getElementById('bannerNominal').textContent = o.nominal || '-';

  var el = document.getElementById('paymentSuccessBanner');
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function closePaymentBanner() {
  var el = document.getElementById('paymentSuccessBanner');
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function sharePaymentToWA() {
  var nama    = document.getElementById('bannerNamaBlok') ? document.getElementById('bannerNamaBlok').textContent : '';
  var periode = document.getElementById('bannerPeriode')  ? document.getElementById('bannerPeriode').textContent  : '-';
  var nominal = document.getElementById('bannerNominal')  ? document.getElementById('bannerNominal').textContent  : '-';

  var btn = document.querySelector('button[onclick="sharePaymentToWA()"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyiapkan...';
  }

  // Capture langsung kartu struk yang tampil (paymentReceiptArea) → hasil = persis modal
  var container = document.getElementById('paymentReceiptArea');
  if (!container) { fallbackShareWA_(nama, periode, nominal, btn); return; }

  html2canvas(container, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false
  }).then(function(canvas) {


    canvas.toBlob(function(blob) {
      var isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      if (isMobile && navigator.share && navigator.canShare) {
        var file = new File([blob], 'bukti-ipl.jpg', { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] })
            .then(function() { resetShareBtn_(btn); })
            .catch(function() { fallbackShareWA_(nama, periode, nominal, btn); });
          return;
        }
      }
      fallbackShareWA_(nama, periode, nominal, btn);
    }, 'image/jpeg', 0.95);

  }).catch(function(err) {
    console.error('html2canvas error:', err);
    fallbackShareWA_(nama, periode, nominal, btn);
  });
}

function resetShareBtn_(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;flex-shrink:0;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Share ke WhatsApp';
}

function fallbackShareWA_(nama, periode, nominal, btn) {
  var isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isMobile) {
    // Mobile tapi share API tidak support file — fallback text
    var text = '\u2705 *Bukti Pembayaran IPL*\n\n' +
      'Nama   : ' + nama + '\n' +
      'Periode: ' + periode + '\n' +
      'Nominal: ' + nominal + '\n' +
      'Status : Menunggu Verifikasi\n\n' +
      '_Pengurus Paguyuban Jade Park Serpong 2_';
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    resetShareBtn_(btn);
    return;
  }

  // Desktop: download image + tampil instruksi
  var container = document.getElementById('paymentReceiptArea');
  if (!container) {
    resetShareBtn_(btn);
    return;
  }

  html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false
  }).then(function(canvas) {

    // Download image
    var link = document.createElement('a');
    link.download = 'bukti-ipl-' + nama.replace(/\s+/g, '-') + '.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();

    // Toast instruksi
    showToast('Gambar diunduh. Silakan kirim manual ke WhatsApp.', 'info');
    resetShareBtn_(btn);

  }).catch(function() {
    resetShareBtn_(btn);
  });
}

function filterContactList(query) {
  var items = document.querySelectorAll('#contactList .contact-item');
  var q = query.toLowerCase();
  items.forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = text.indexOf(q) !== -1 ? '' : 'none';
  });
}

function filterSecurityList(query) {
  var items = document.querySelectorAll('#securityContactList .contact-item');
  var q = query.toLowerCase();
  items.forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = text.indexOf(q) !== -1 ? '' : 'none';
  });
}

function copyRekeningSheet() {
  var noRek = '7305014010';
  var textEl = document.getElementById('copyRekeningSheetText');

  function onSuccess() {
    showToast('Nomor rekening berhasil disalin', 'success');
    if (textEl) textEl.textContent = 'Tersalin!';
    setTimeout(function() {
      if (textEl) textEl.textContent = 'Salin';
    }, 2000);
  }

  function onFail() {
    // Fallback: execCommand
    try {
      var el = document.createElement('textarea');
      el.value = noRek;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      onSuccess();
    } catch(e) {
      showToast('7305014010 · BCA a.n. Imam Jaswidi', 'info');
    }
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(noRek).then(onSuccess).catch(onFail);
  } else {
    onFail();
  }
}

function showDetailPaymentSkeleton_(show) {
  var skeleton = document.getElementById('detailPaymentSkeleton');
  var card     = document.getElementById('detailPaymentCard');
  if (!skeleton || !card) return;
  if (show) {
    skeleton.classList.remove('hidden');
    card.classList.add('hidden');
  } else {
    skeleton.classList.add('hidden');
    card.classList.remove('hidden');
  }
}

/* ============================================================
   KAS IPL VIEWER
   ============================================================ */
/* ============================================================
   ADMIN — Browser + CRUD Laporan Kas IPL (tim Bendahara)
   Menjelajah folder Drive (folder tahun → file), upload / rename /
   hapus file — semua dari dalam app tanpa buka Google Drive.
   ============================================================ */
/* ── Admin panel: tab navbar + konten CRUD inline ── */
var _ADMIN_TAB_LOADERS_ = {
  ringkasan : function() { if (typeof loadAdminSummary    === 'function') loadAdminSummary(); },
  info      : function() { if (typeof openInfoCRUD       === 'function') openInfoCRUD(); },
  warga     : function() { if (typeof openDataWargaCRUD  === 'function') openDataWargaCRUD(); },
  greeting  : function() { if (typeof openGreetingCRUD   === 'function') openGreetingCRUD(); },
  fasum     : function() { if (typeof openFasumCRUD      === 'function') openFasumCRUD(); },
  pengaduan : function() { if (typeof openAdminPengaduan === 'function') openAdminPengaduan(); },
  pendaftar : function() { if (typeof openWargaBaruCRUD  === 'function') openWargaBaruCRUD(); },
  kasipl    : function() { if (typeof openKasIplCRUD     === 'function') openKasIplCRUD(); },
  pengeluaran: function() { if (typeof openPengeluaran  === 'function') openPengeluaran(); },
  jualanqc  : function() { if (typeof openJualanQC     === 'function') openJualanQC(); },
  lomba17   : function() { if (typeof loadAdminLomba17Preview === 'function') loadAdminLomba17Preview(); },
  jadwaljaga: function() { if (typeof openJadwalJagaAdmin === 'function') openJadwalJagaAdmin(); },
  menu      : function() { if (typeof _syncVotingToggleUI_ === 'function') _syncVotingToggleUI_(); },
  verifikasi: function() { if (typeof _renderVerifikasiInline_ === 'function') _renderVerifikasiInline_(); }
};

/* ================= BUKU KAS: PENGELUARAN ================= */
var _PENGELUARAN_KAT_ = {
  'Mitra & Gaji'    : ['Security/Satpam','Kebersihan/Kang taman','Admin/Bendahara','Lainnya'],
  'Utilitas'        : ['Listrik','Air','Internet/CCTV','Lainnya'],
  'Perawatan Fasum' : ['Gerbang/Portal','Taman','Kolam','Alat','Perbaikan','Lainnya'],
  'Operasional'     : ['ATK','Konsumsi rapat','Transport','Cetak','Lainnya'],
  'THR & Tunjangan' : ['THR Mitra','Bonus','Lainnya'],
  'Lain-lain'       : []
};
var _PENG_MONTHS_ = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
var _PENG_COLORS_ = ['#3b82f6','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#3b82f6','#EC4899','#6B7280'];
var _pengeluaranCache = null;
var _pemasukanCache = null;
var _kasRiwayatMode_ = 'keluar';   // 'keluar' = pengeluaran, 'masuk' = pemasukan manual
var _PEMASUKAN_KAT_ = ['Sumbangan','Donasi','Denda','Sewa Fasum','Bunga Bank','Lain-lain'];
var _pengFilter_ = { periode: '', kategori: '' };
function _kasSetRiwayatMode_(m){ _kasRiwayatMode_ = m; _renderPengeluaran_(); }

function _pengSetFilter_(kind, val){ _pengFilter_[kind] = val; _renderPengeluaran_(); }
// "2026-06-05" → "Jun 2026"
function _pengPeriodeLabel_(tgl){
  var s = String(tgl||''); var m = s.match(/^(\d{4})-(\d{2})/);
  if(!m) return '';
  return _PENG_MONTHS_[parseInt(m[2],10)-1] + ' ' + m[1];
}
function _pengPeriodeKey_(tgl){ var s=String(tgl||''); var m=s.match(/^(\d{4})-(\d{2})/); return m?(m[1]+'-'+m[2]):''; }

function _pengRpFull_(n){ return 'Rp ' + Number(n||0).toLocaleString('id-ID'); }
function _pengRpShort_(n){
  n = Number(n||0);
  var sign = n < 0 ? '-' : '';
  var a = Math.abs(n);
  var s;
  if(a>=1000000) s='Rp '+(a/1000000).toFixed(1).replace('.',',')+' Jt';
  else if(a>=1000) s='Rp '+Math.round(a/1000)+' Rb';
  else s='Rp '+a.toLocaleString('id-ID');
  return sign + s;
}

function _pengIncomeTotal_(){
  var arr = (typeof dashboardConfirmedCache !== 'undefined' && dashboardConfirmedCache) ? dashboardConfirmedCache : [];
  var iplMasuk = arr.reduce(function(s,i){ return s + Number(i.nominal||0); }, 0);
  var manual = (_pemasukanCache && _pemasukanCache.total) ? Number(_pemasukanCache.total) : 0;
  return iplMasuk + manual;
}

// Pastikan data confirmed (uang masuk) tersedia — tanpa harus buka tab Verifikasi dulu
var _pengIncomeLoaded_ = false;
function _pengEnsureIncome_(cb){
  // Sudah ada data dashboard → langsung pakai
  if((typeof dashboardCache !== 'undefined' && dashboardCache) || _pengIncomeLoaded_){ cb(); return; }
  // Coba dari sessionStorage cache
  try {
    var ss = sessionStorage.getItem('dashCache');
    if(ss){
      var p = JSON.parse(ss);
      if(p){
        dashboardCache = p;
        dashboardPendingCache   = p.pending   || [];
        dashboardConfirmedCache = p.confirmed || [];
        dashboardRejectedCache  = p.rejected  || [];
        _pengIncomeLoaded_ = true;
        cb(); return;
      }
    }
  } catch(e){}
  // Fetch langsung
  gasGet_('getDashboardDataOptimized').then(function(res){
    if(res){
      dashboardCache = res;
      dashboardPendingCache   = res.pending   || [];
      dashboardConfirmedCache = res.confirmed || [];
      dashboardRejectedCache  = res.rejected  || [];
      try { res._ts = Date.now(); sessionStorage.setItem('dashCache', JSON.stringify(res)); } catch(e){}
    }
    _pengIncomeLoaded_ = true;
    cb();
  }).catch(function(){ _pengIncomeLoaded_ = true; cb(); });
}

function openPengeluaran(force){
  var box = document.getElementById('pengeluaranContent');
  if(!box) return;
  // Pakai cache: render instan tanpa loading kalau sudah pernah dimuat
  if(!force && _pengeluaranCache && _pemasukanCache){ _pengEnsureIncome_(function(){ _renderPengeluaran_(); }); return; }
  // Skeleton shimmer — konsisten dgn loader lain di app
  box.innerHTML =
    '<div class="flex flex-col gap-3 pt-1">' +
      '<div class="skeleton rounded-2xl w-full" style="height:120px;"></div>' +
      '<div class="skeleton rounded-2xl w-full" style="height:84px;"></div>' +
      '<div class="skeleton rounded-2xl w-full" style="height:84px;"></div>' +
    '</div>';
  Promise.all([gasGet_('adminGetPengeluaran'), gasGet_('adminGetPemasukan')]).then(function(arr){
    _pengeluaranCache = arr[0] || {data:[],total:0};
    _pemasukanCache   = arr[1] || {data:[],total:0};
    _pengEnsureIncome_(function(){ _renderPengeluaran_(); });
  }).catch(function(){
    box.innerHTML = '<div class="text-center text-red-400 text-sm py-8">Gagal memuat. <button onclick="openPengeluaran(true)" class="text-primary font-semibold underline">Coba lagi</button></div>';
  });
}

function _renderPengeluaran_(){
  var box = document.getElementById('pengeluaranContent');
  if(!box) return;
  var allData = (_pengeluaranCache && _pengeluaranCache.data) ? _pengeluaranCache.data : [];
  var keluarAll = (_pengeluaranCache && _pengeluaranCache.total) ? _pengeluaranCache.total : 0;
  var saldoAwal = (_pengeluaranCache && _pengeluaranCache.saldoAwal) ? Number(_pengeluaranCache.saldoAwal) : 0;
  var masuk  = _pengIncomeTotal_();
  var saldo  = saldoAwal + masuk - keluarAll;

  // ---- Filter (periode by tanggal + kategori) ----
  var data = allData.filter(function(d){
    if(_pengFilter_.periode && _pengPeriodeKey_(d.tanggal) !== _pengFilter_.periode) return false;
    if(_pengFilter_.kategori && d.kategori !== _pengFilter_.kategori) return false;
    return true;
  });
  var keluarFilter = data.reduce(function(s,d){ return s + Number(d.nominal||0); }, 0);

  var saldoCard =
    '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">' +
      '<div class="grid grid-cols-3 divide-x divide-gray-100">' +
        '<div class="px-2 text-center"><p class="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Masuk</p><p class="text-base font-black text-blue-600 mt-1 whitespace-nowrap">'+_pengRpShort_(masuk)+'</p></div>' +
        '<div class="px-2 text-center"><p class="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Keluar</p><p class="text-base font-black text-red-500 mt-1 whitespace-nowrap">'+_pengRpShort_(keluarAll)+'</p></div>' +
        '<div class="px-2 text-center"><p class="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Saldo</p><p class="text-base font-black '+(saldo>=0?'text-gray-900':'text-red-600')+' mt-1 whitespace-nowrap">'+_pengRpShort_(saldo)+'</p></div>' +
      '</div>' +
      '<div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">' +
        '<span class="text-[11px] text-gray-400">Saldo awal · <span class="font-semibold text-gray-600">'+_pengRpFull_(saldoAwal)+'</span></span>' +
        '<button onclick="openSaldoAwalModal()" class="text-[11px] font-semibold text-primary px-2.5 py-1 rounded-lg bg-primary/10 active:scale-95 transition">Atur</button>' +
      '</div>' +
    '</div>';

  // ---- Donut breakdown (kategori, dari data terfilter) ----
  var byKat = {};
  data.forEach(function(d){ byKat[d.kategori] = (byKat[d.kategori]||0) + Number(d.nominal||0); });
  var katKeys = Object.keys(byKat).sort(function(a,b){return byKat[b]-byKat[a];});
  var donutCard = '';
  if(keluarFilter > 0 && katKeys.length){
    var acc = 0, stops = [], legend = '';
    katKeys.forEach(function(k, i){
      var col = _PENG_COLORS_[i % _PENG_COLORS_.length];
      var pct = byKat[k] / keluarFilter * 100;
      var start = acc, end = acc + pct; acc = end;
      stops.push(col+' '+start.toFixed(2)+'% '+end.toFixed(2)+'%');
      legend += '<div class="flex items-center justify-between text-xs py-1">' +
        '<span class="flex items-center gap-1.5 min-w-0"><span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:'+col+'"></span><span class="text-gray-600 truncate">'+k+'</span></span>' +
        '<span class="font-semibold text-gray-700 flex-shrink-0 ml-2">'+_pengRpFull_(byKat[k])+' <span class="text-gray-400 font-normal">'+Math.round(pct)+'%</span></span>' +
      '</div>';
    });
    var donut =
      '<div class="relative flex-shrink-0" style="width:104px;height:104px;border-radius:50%;background:conic-gradient('+stops.join(',')+');">' +
        '<div class="absolute bg-white rounded-full flex flex-col items-center justify-center" style="inset:18px;">' +
          '<span class="text-[9px] text-gray-400 font-semibold uppercase">Keluar</span>' +
          '<span class="text-[11px] font-black text-gray-800 leading-tight">'+_pengRpShort_(keluarFilter)+'</span>' +
        '</div>' +
      '</div>';
    donutCard =
      '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">' +
        '<div class="flex items-center gap-4">' + donut + '<div class="flex-1 min-w-0">'+legend+'</div>' + '</div>' +
      '</div>';
  }

  // ---- Filter bar ----
  var periods = [];
  allData.forEach(function(d){ var k=_pengPeriodeKey_(d.tanggal); if(k && periods.indexOf(k)===-1) periods.push(k); });
  periods.sort().reverse();
  var periodeOpts = '<option value="">Semua periode</option>' + periods.map(function(k){
    return '<option value="'+k+'"'+(k===_pengFilter_.periode?' selected':'')+'>'+_pengPeriodeLabel_(k+'-01')+'</option>';
  }).join('');
  var katOpts = '<option value="">Semua kategori</option>' + Object.keys(_PENGELUARAN_KAT_).map(function(k){
    return '<option value="'+k+'"'+(k===_pengFilter_.kategori?' selected':'')+'>'+k+'</option>';
  }).join('');
  var filterBar =
    '<div class="grid grid-cols-2 gap-2">' +
      '<select onchange="_pengSetFilter_(\'periode\', this.value)" class="app-input text-sm">'+periodeOpts+'</select>' +
      '<select onchange="_pengSetFilter_(\'kategori\', this.value)" class="app-input text-sm">'+katOpts+'</select>' +
    '</div>';

  var isMasuk = _kasRiwayatMode_ === 'masuk';
  var masukData = (_pemasukanCache && _pemasukanCache.data) ? _pemasukanCache.data : [];

  // ---- Toggle Pengeluaran / Pemasukan ----
  var tabBtn = function(mode, label){
    var on = (_kasRiwayatMode_ === mode);
    return '<button onclick="_kasSetRiwayatMode_(\''+mode+'\')" class="flex-1 text-xs font-bold py-2 rounded-lg transition '+(on?'bg-white shadow-sm '+(mode==='masuk'?'text-blue-600':'text-red-500'):'text-gray-400')+'">'+label+'</button>';
  };
  var modeToggle =
    '<div class="flex gap-1 p-1 bg-gray-100 rounded-xl">' + tabBtn('keluar','Pengeluaran') + tabBtn('masuk','Pemasukan') + '</div>';

  var addBtn = isMasuk
    ? '<button onclick="openPemasukanForm(null)" class="flex items-center gap-1 px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold active:scale-95 transition"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Pemasukan</button>'
    : '<button onclick="openPengeluaranForm(null)" class="flex items-center gap-1 px-3 py-2 rounded-xl bg-primary text-white text-xs font-semibold active:scale-95 transition"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Tambah</button>';

  var header =
    '<div class="flex items-center justify-between">' +
      '<p class="text-xs font-bold text-gray-500 uppercase tracking-wide">Riwayat'+((!isMasuk&&keluarFilter!==keluarAll)?(' · '+_pengRpShort_(keluarFilter)):'')+'</p>' +
      '<div class="flex items-center gap-2">' +
        '<button onclick="openKasSettings()" title="TTD & Logo" class="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 bg-gray-100 active:scale-95 transition">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 7h-9M14 17H5M17 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>' +
        '</button>' +
        '<button onclick="openPengeluaran(true)" title="Muat ulang" class="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 bg-gray-100 active:scale-95 transition">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M5 19a9 9 0 0 0 14-5M19 5a9 9 0 0 0-14 5"/></svg>' +
        '</button>' + addBtn +
      '</div>' +
    '</div>';

  var list;
  if(isMasuk){
    list = masukData.map(function(d){
      return '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">' +
        '<div class="flex items-start justify-between gap-2">' +
          '<div class="min-w-0">' +
            '<p class="text-sm font-bold text-gray-900 truncate">'+d.kategori+'</p>' +
            '<p class="text-[11px] text-gray-400 mt-0.5">'+(d.tanggal||'')+(d.metode?(' · '+d.metode):'')+'</p>' +
            (d.keterangan? '<p class="text-[11px] text-gray-500 mt-0.5 truncate">'+d.keterangan+'</p>' : '') +
          '</div>' +
          '<span class="text-sm font-black text-blue-600 flex-shrink-0">'+_pengRpFull_(d.nominal)+'</span>' +
        '</div>' +
        '<div class="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">' +
          (d.buktiUrl? '<button type="button" data-bukti="'+d.buktiUrl+'" class="lihat-bukti-btn text-[11px] font-semibold text-gray-500 px-2.5 py-1 rounded-lg bg-gray-100">Bukti</button>' : '') +
          '<button onclick="openPemasukanForm('+d.rowNumber+')" class="text-[11px] font-semibold text-primary px-2.5 py-1 rounded-lg bg-primary/10">Edit</button>' +
          '<button onclick="deletePemasukanConfirm('+d.rowNumber+')" class="text-[11px] font-semibold text-red-600 px-2.5 py-1 rounded-lg bg-red-50">Hapus</button>' +
        '</div>' +
      '</div>';
    }).join('') || '<div class="text-center text-gray-400 text-sm py-6">Belum ada pemasukan manual. Klik Pemasukan untuk catat sumbangan dll.</div>';
  } else {
    list = data.map(function(d){
      var sub = d.sub ? ' · ' + d.sub : '';
      return '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">' +
        '<div class="flex items-start justify-between gap-2">' +
          '<div class="min-w-0">' +
            '<p class="text-sm font-bold text-gray-900 truncate">'+d.kategori+'<span class="font-normal text-gray-400">'+sub+'</span></p>' +
            '<p class="text-[11px] text-gray-400 mt-0.5">'+(d.tanggal||'')+(d.metode?(' · '+d.metode):'')+(d.bulanAlokasi?(' · '+d.bulanAlokasi):'')+'</p>' +
            (d.keterangan? '<p class="text-[11px] text-gray-500 mt-0.5 truncate">'+d.keterangan+'</p>' : '') +
          '</div>' +
          '<span class="text-sm font-black text-red-500 flex-shrink-0">'+_pengRpFull_(d.nominal)+'</span>' +
        '</div>' +
        '<div class="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">' +
          (d.buktiUrl? '<button type="button" data-bukti="'+d.buktiUrl+'" class="lihat-bukti-btn text-[11px] font-semibold text-gray-500 px-2.5 py-1 rounded-lg bg-gray-100">Bukti</button>' : '') +
          '<button onclick="openPengeluaranForm('+d.rowNumber+')" class="text-[11px] font-semibold text-primary px-2.5 py-1 rounded-lg bg-primary/10">Edit</button>' +
          '<button onclick="deletePengeluaranConfirm('+d.rowNumber+')" class="text-[11px] font-semibold text-red-600 px-2.5 py-1 rounded-lg bg-red-50">Hapus</button>' +
        '</div>' +
      '</div>';
    }).join('') || '<div class="text-center text-gray-400 text-sm py-6">'+(allData.length?'Tidak ada data pada filter ini.':'Belum ada pengeluaran. Klik Tambah.')+'</div>';
  }

  var listCount = isMasuk ? masukData.length : data.length;
  var listWrap = listCount
    ? '<div class="grid gap-2 xl:grid-cols-2">'+list+'</div>'
    : '<div>'+list+'</div>';
  box.innerHTML =
    '<div class="w-full space-y-3">' +
      saldoCard +
      '<div class="lg:grid lg:grid-cols-3 lg:gap-3 lg:items-start space-y-3 lg:space-y-0">' +
        '<div class="lg:col-span-1 space-y-3">' + donutCard + filterBar + '</div>' +
        '<div class="lg:col-span-2 space-y-3">' + modeToggle + header + listWrap + '</div>' +
      '</div>' +
    '</div>';
}

function _pengFillKategori_(selected){
  var el = document.getElementById('pengeluaranFormKategori');
  if(!el) return;
  el.innerHTML = Object.keys(_PENGELUARAN_KAT_).map(function(k){
    return '<option value="'+k+'"'+(k===selected?' selected':'')+'>'+k+'</option>';
  }).join('');
}
function _pengKatChange_(selectedSub){
  var katEl = document.getElementById('pengeluaranFormKategori');
  var el = document.getElementById('pengeluaranFormSub');
  if(!katEl || !el) return;
  var subs = _PENGELUARAN_KAT_[katEl.value] || [];
  el.innerHTML = '<option value="">—</option>' + subs.map(function(s){
    return '<option value="'+s+'"'+(s===selectedSub?' selected':'')+'>'+s+'</option>';
  }).join('');
}
function _pengFillBulan_(selected){
  var el = document.getElementById('pengeluaranFormBulan');
  if(!el) return;
  var yr = new Date().getFullYear();
  el.innerHTML = '<option value="">—</option>' + _PENG_MONTHS_.map(function(m){
    var v = m+' '+yr;
    return '<option value="'+v+'"'+(v===selected?' selected':'')+'>'+v+'</option>';
  }).join('');
}

function openPengeluaranForm(rowNumber){
  var d = null;
  if(rowNumber && _pengeluaranCache && _pengeluaranCache.data){
    d = _pengeluaranCache.data.find(function(x){return x.rowNumber===rowNumber;}) || null;
  }
  var _modal = document.getElementById('pengeluaranFormModal');
  _modal.classList.remove('hidden');
  // Cegah "ghost tap" — tap dari tombol Edit yg nyangkut ke field date di modal baru
  var _card = _modal.firstElementChild;
  if (_card) { _card.style.pointerEvents = 'none'; setTimeout(function(){ _card.style.pointerEvents = ''; }, 350); }
  document.getElementById('pengeluaranFormTitle').innerText = d ? 'Edit Pengeluaran' : 'Tambah Pengeluaran';
  document.getElementById('pengeluaranFormRow').value = d ? d.rowNumber : '';
  document.getElementById('pengeluaranFormTanggal').value = d ? d.tanggal : (function(){var t=new Date();return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');})();
  _pengFillKategori_(d ? d.kategori : 'Mitra & Gaji');
  _pengKatChange_(d ? d.sub : '');
  _iplSetRupiah_('pengeluaranFormNominal', d ? d.nominal : '');
  document.getElementById('pengeluaranFormKeterangan').value = d ? d.keterangan : '';
  document.getElementById('pengeluaranFormMetode').value = d ? (d.metode||'Cash') : 'Cash';
  _pengFillBulan_(d ? d.bulanAlokasi : '');
  var _bukti = d ? (d.buktiUrl||'') : '';
  document.getElementById('pengeluaranFormBuktiUrl').value = _bukti;
  document.getElementById('pengeluaranFormBuktiFile').value = '';
  _pengShowBuktiPreview_(_bukti, '');
}

// Tampilkan/sembunyikan preview bukti. localDataUrl opsional (preview gambar lokal saat upload)
function _pengShowBuktiPreview_(url, localDataUrl){
  var preview = document.getElementById('pengeluaranFormBuktiPreview');
  var img     = document.getElementById('pengeluaranFormBuktiImg');
  var icon    = document.getElementById('pengeluaranFormBuktiIcon');
  var status  = document.getElementById('pengeluaranFormBuktiStatus');
  var link    = document.getElementById('pengeluaranFormBuktiLink');
  var label   = document.getElementById('pengeluaranFormBuktiLabel');
  if(!preview) return;
  if(!url && !localDataUrl){
    preview.classList.add('hidden');
    label.innerText = '+ Upload bukti';
    return;
  }
  preview.classList.remove('hidden');
  label.innerText = 'Ganti bukti';
  if(localDataUrl){ img.src = localDataUrl; img.classList.remove('hidden'); icon.classList.add('hidden'); }
  else { img.classList.add('hidden'); icon.classList.remove('hidden'); }
  status.innerText = 'Bukti terlampir';
  if(link){
    if(url){ link.dataset.bukti = url; link.style.display = ''; }
    else { link.removeAttribute('data-bukti'); link.style.display = 'none'; }
  }
}

function _pengRemoveBukti_(){
  document.getElementById('pengeluaranFormBuktiUrl').value = '';
  document.getElementById('pengeluaranFormBuktiFile').value = '';
  _pengShowBuktiPreview_('', '');
}
// Cegah "ghost tap": setelah modal ditutup, tap yang nyangkut bisa membuka native date-picker
// yang kebetulan ada di bawah jari. Shield transparan menyerap tap sesaat.
function _ghostShield_(ms){
  try {
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var s = document.createElement('div');
    s.style.cssText = 'position:fixed;inset:0;z-index:99999;background:transparent;';
    s.addEventListener('touchstart', function(e){ e.preventDefault(); }, { passive:false });
    document.body.appendChild(s);
    setTimeout(function(){ if(s && s.parentNode) s.parentNode.removeChild(s); }, ms || 400);
  } catch(e){}
}
function closePengeluaranForm(){ document.getElementById('pengeluaranFormModal').classList.add('hidden'); _ghostShield_(); }

function _pengUploadBukti_(input){
  var file = input.files && input.files[0];
  if(!file) return;
  var status = document.getElementById('pengeluaranFormBuktiStatus');
  var reader = new FileReader();
  reader.onload = function(e){
    var dataUrl = e.target.result;
    var isImg = file.type.indexOf('image') === 0;
    // Preview lokal langsung (sebelum selesai upload)
    _pengShowBuktiPreview_('', isImg ? dataUrl : '');
    if(status) status.innerText = 'Mengupload...';
    var base64 = dataUrl.split(',')[1];
    gasPost_('uploadBuktiTransfer', { base64: base64, filename: file.name, mimeType: file.type, meta:{ jenis:'pengeluaran' } })
      .then(function(res){
        var url = (res && res.url) || '';
        document.getElementById('pengeluaranFormBuktiUrl').value = url;
        _pengShowBuktiPreview_(url, isImg ? dataUrl : '');
        if(status) status.innerText = '✓ Bukti terlampir';
      })
      .catch(function(){ if(status) status.innerText = 'Gagal upload, coba lagi'; showToast('Upload gagal','error'); });
  };
  reader.readAsDataURL(file);
}

function savePengeluaranForm(){
  var kategori = document.getElementById('pengeluaranFormKategori').value;
  var nominal  = _iplNumVal_('pengeluaranFormNominal');
  if(!kategori){ showToast('Kategori wajib','error'); return; }
  if(!nominal){ showToast('Nominal wajib diisi','error'); return; }
  var btn = document.getElementById('pengeluaranFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Menyimpan...</span>';
  var payload = {
    rowNumber   : parseInt(document.getElementById('pengeluaranFormRow').value)||null,
    tanggal     : document.getElementById('pengeluaranFormTanggal').value,
    kategori    : kategori,
    sub         : document.getElementById('pengeluaranFormSub').value,
    keterangan  : document.getElementById('pengeluaranFormKeterangan').value.trim(),
    nominal     : nominal,
    metode      : document.getElementById('pengeluaranFormMetode').value,
    bulanAlokasi: document.getElementById('pengeluaranFormBulan').value,
    buktiUrl    : document.getElementById('pengeluaranFormBuktiUrl').value,
    dicatatOleh : currentUser ? currentUser.email : ''
  };
  gasPost_('adminSavePengeluaran', { payload: payload }).then(function(){
    btn.disabled=false; btn.innerText='Simpan';
    closePengeluaranForm();
    showToast('Pengeluaran disimpan','success');
    _pengeluaranCache = null; openPengeluaran(true);
  }).catch(function(){ btn.disabled=false; btn.innerText='Simpan'; showToast('Gagal menyimpan','error'); });
}

function deletePengeluaranConfirm(rowNumber){
  var d = (_pengeluaranCache&&_pengeluaranCache.data)? _pengeluaranCache.data.find(function(x){return x.rowNumber===rowNumber;}):null;
  var label = d ? (d.kategori+' '+_pengRpFull_(d.nominal)) : 'item ini';
  if(typeof showDeleteConfirm==='function'){ showDeleteConfirm('Hapus '+label+'?', function(){ _doDeletePengeluaran_(rowNumber); }); }
  else if(confirm('Hapus '+label+'?')){ _doDeletePengeluaran_(rowNumber); }
}
function _doDeletePengeluaran_(rowNumber){
  gasPost_('adminDeletePengeluaran', { rowNumber: rowNumber }).then(function(){
    if(typeof closeDeleteConfirm==='function') closeDeleteConfirm();
    showToast('Pengeluaran dihapus','success'); _pengeluaranCache = null; openPengeluaran(true);
  }).catch(function(){
    if(typeof closeDeleteConfirm==='function') closeDeleteConfirm();
    showToast('Gagal menghapus','error');
  });
}

/* ===== PEMASUKAN MANUAL (sumbangan/donasi/dll) ===== */
function _pemFillKategori_(selected){
  var el = document.getElementById('pemasukanFormKategori');
  if(!el) return;
  el.innerHTML = _PEMASUKAN_KAT_.map(function(k){
    return '<option value="'+k+'"'+(k===selected?' selected':'')+'>'+k+'</option>';
  }).join('');
}
function openPemasukanForm(rowNumber){
  var d = null;
  if(rowNumber && _pemasukanCache && _pemasukanCache.data){
    d = _pemasukanCache.data.find(function(x){return x.rowNumber===rowNumber;}) || null;
  }
  var _modal = document.getElementById('pemasukanFormModal');
  _modal.classList.remove('hidden');
  var _card = _modal.firstElementChild;
  if (_card) { _card.style.pointerEvents = 'none'; setTimeout(function(){ _card.style.pointerEvents = ''; }, 350); }
  document.getElementById('pemasukanFormTitle').innerText = d ? 'Edit Pemasukan' : 'Tambah Pemasukan';
  document.getElementById('pemasukanFormRow').value = d ? d.rowNumber : '';
  document.getElementById('pemasukanFormTanggal').value = d ? d.tanggal : (function(){var t=new Date();return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');})();
  _pemFillKategori_(d ? d.kategori : 'Sumbangan');
  _iplSetRupiah_('pemasukanFormNominal', d ? d.nominal : '');
  document.getElementById('pemasukanFormKeterangan').value = d ? d.keterangan : '';
  document.getElementById('pemasukanFormMetode').value = d ? (d.metode||'Cash') : 'Cash';
  var _bukti = d ? (d.buktiUrl||'') : '';
  document.getElementById('pemasukanFormBuktiUrl').value = _bukti;
  document.getElementById('pemasukanFormBuktiFile').value = '';
  _pemShowBuktiPreview_(_bukti, '');
}
function _pemShowBuktiPreview_(url, localDataUrl){
  var preview = document.getElementById('pemasukanFormBuktiPreview');
  var img     = document.getElementById('pemasukanFormBuktiImg');
  var icon    = document.getElementById('pemasukanFormBuktiIcon');
  var status  = document.getElementById('pemasukanFormBuktiStatus');
  var link    = document.getElementById('pemasukanFormBuktiLink');
  var label   = document.getElementById('pemasukanFormBuktiLabel');
  if(!preview) return;
  if(!url && !localDataUrl){ preview.classList.add('hidden'); label.innerText = '+ Upload bukti'; return; }
  preview.classList.remove('hidden');
  label.innerText = 'Ganti bukti';
  if(localDataUrl){ img.src = localDataUrl; img.classList.remove('hidden'); icon.classList.add('hidden'); }
  else { img.classList.add('hidden'); icon.classList.remove('hidden'); }
  status.innerText = 'Bukti terlampir';
  if(link){ if(url){ link.dataset.bukti = url; link.style.display = ''; } else { link.removeAttribute('data-bukti'); link.style.display = 'none'; } }
}
function _pemRemoveBukti_(){
  document.getElementById('pemasukanFormBuktiUrl').value = '';
  document.getElementById('pemasukanFormBuktiFile').value = '';
  _pemShowBuktiPreview_('', '');
}
function closePemasukanForm(){ document.getElementById('pemasukanFormModal').classList.add('hidden'); _ghostShield_(); }
function _pemUploadBukti_(input){
  var file = input.files && input.files[0];
  if(!file) return;
  var status = document.getElementById('pemasukanFormBuktiStatus');
  var reader = new FileReader();
  reader.onload = function(e){
    var dataUrl = e.target.result;
    var isImg = file.type.indexOf('image') === 0;
    _pemShowBuktiPreview_('', isImg ? dataUrl : '');
    if(status) status.innerText = 'Mengupload...';
    var base64 = dataUrl.split(',')[1];
    gasPost_('uploadBuktiTransfer', { base64: base64, filename: file.name, mimeType: file.type, meta:{ jenis:'pemasukan' } })
      .then(function(res){
        var url = (res && res.url) || '';
        document.getElementById('pemasukanFormBuktiUrl').value = url;
        _pemShowBuktiPreview_(url, isImg ? dataUrl : '');
        if(status) status.innerText = '✓ Bukti terlampir';
      })
      .catch(function(){ if(status) status.innerText = 'Gagal upload, coba lagi'; showToast('Upload gagal','error'); });
  };
  reader.readAsDataURL(file);
}
function savePemasukanForm(){
  var kategori = document.getElementById('pemasukanFormKategori').value;
  var nominal  = _iplNumVal_('pemasukanFormNominal');
  if(!kategori){ showToast('Kategori wajib','error'); return; }
  if(!nominal){ showToast('Nominal wajib diisi','error'); return; }
  var btn = document.getElementById('pemasukanFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px"><svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Menyimpan...</span>';
  var payload = {
    rowNumber  : parseInt(document.getElementById('pemasukanFormRow').value)||null,
    tanggal    : document.getElementById('pemasukanFormTanggal').value,
    kategori   : kategori,
    keterangan : document.getElementById('pemasukanFormKeterangan').value.trim(),
    nominal    : nominal,
    metode     : document.getElementById('pemasukanFormMetode').value,
    buktiUrl   : document.getElementById('pemasukanFormBuktiUrl').value,
    dicatatOleh: currentUser ? currentUser.email : ''
  };
  gasPost_('adminSavePemasukan', { payload: payload }).then(function(){
    btn.disabled=false; btn.innerText='Simpan';
    closePemasukanForm();
    showToast('Pemasukan disimpan','success');
    _pemasukanCache = null; _pengeluaranCache = null; _kasReportCache = {}; _kasReportYear_ = null;
    openPengeluaran(true);
  }).catch(function(){ btn.disabled=false; btn.innerText='Simpan'; showToast('Gagal menyimpan','error'); });
}
function deletePemasukanConfirm(rowNumber){
  var d = (_pemasukanCache&&_pemasukanCache.data)? _pemasukanCache.data.find(function(x){return x.rowNumber===rowNumber;}):null;
  var label = d ? (d.kategori+' '+_pengRpFull_(d.nominal)) : 'item ini';
  if(typeof showDeleteConfirm==='function'){ showDeleteConfirm('Hapus '+label+'?', function(){ _doDeletePemasukan_(rowNumber); }); }
  else if(confirm('Hapus '+label+'?')){ _doDeletePemasukan_(rowNumber); }
}
function _doDeletePemasukan_(rowNumber){
  gasPost_('adminDeletePemasukan', { rowNumber: rowNumber }).then(function(){
    if(typeof closeDeleteConfirm==='function') closeDeleteConfirm();
    showToast('Pemasukan dihapus','success');
    _pemasukanCache = null; _kasReportCache = {}; _kasReportYear_ = null;
    openPengeluaran(true);
  }).catch(function(){
    if(typeof closeDeleteConfirm==='function') closeDeleteConfirm();
    showToast('Gagal menghapus','error');
  });
}

// ===== Saldo Awal (opening balance) =====
function openSaldoAwalModal(){
  var sa = (_pengeluaranCache && _pengeluaranCache.saldoAwal) ? _pengeluaranCache.saldoAwal : 0;
  _iplSetRupiah_('saldoAwalInput', sa);
  var h = document.getElementById('saldoAwalInputHint'); if(h) h.classList.add('hidden');
  document.getElementById('saldoAwalModal').classList.remove('hidden');
}
function closeSaldoAwalModal(){ document.getElementById('saldoAwalModal').classList.add('hidden'); _ghostShield_(); }
function saveSaldoAwal(){
  var v = _iplNumVal_('saldoAwalInput');
  var btn = document.getElementById('saldoAwalSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px"><svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Menyimpan...</span>';
  gasPost_('adminSetSaldoAwal', { payload: { saldoAwal: v } }).then(function(){
    btn.disabled = false; btn.innerText = 'Simpan';
    closeSaldoAwalModal();
    showToast('Saldo awal disimpan','success');
    // Invalidate semua cache kas → refresh saldo di Buku Kas & Home
    _pengeluaranCache = null; _kasReportCache = {}; _kasReportYear_ = null;
    openPengeluaran(true);
    if(typeof _renderSaldoKasCard_ === 'function') _renderSaldoKasCard_();
  }).catch(function(){ btn.disabled = false; btn.innerText = 'Simpan'; showToast('Gagal menyimpan','error'); });
}

// ===== Pengaturan TTD & Logo (admin) =====
var _ksImg_ = { logo:'', bendaharaSign:'', ketuaSign:'' };
function _ksShowPrev_(id, src){ var p=document.getElementById(id); if(p){ p.src=src; p.classList.remove('hidden'); } }
function _ksPickImg_(input, key){
  var file = input.files && input.files[0]; if(!file) return;
  var maxW = (key==='logo') ? 180 : 280;
  var reader = new FileReader();
  reader.onload = function(e){
    var img = new Image();
    img.onload = function(){
      var scale = Math.min(1, maxW/img.width);
      var w = Math.round(img.width*scale), h = Math.round(img.height*scale);
      var cv = document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      var dataUrl = cv.toDataURL('image/png');
      _ksImg_[key] = dataUrl;
      _ksShowPrev_(key==='logo'?'ksLogoPrev':(key==='bendaharaSign'?'ksBendaharaPrev':'ksKetuaPrev'), dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function openKasSettings(){
  document.getElementById('kasSettingsModal').classList.remove('hidden');
  _ksImg_ = { logo:'', bendaharaSign:'', ketuaSign:'' };
  ['ksLogoPrev','ksBendaharaPrev','ksKetuaPrev'].forEach(function(id){ var p=document.getElementById(id); if(p){ p.src=''; p.classList.add('hidden'); } });
  document.getElementById('ksBendaharaName').value = '';
  document.getElementById('ksKetuaName').value = '';
  gasGet_('getKasSettings').then(function(r){
    var s = (r && r.settings) ? r.settings : {};
    _kasSettingsCache = s;
    document.getElementById('ksBendaharaName').value = s.bendaharaName || '';
    document.getElementById('ksKetuaName').value = s.ketuaName || '';
    if(s.logo){ _ksImg_.logo=s.logo; _ksShowPrev_('ksLogoPrev', s.logo); }
    if(s.bendaharaSign){ _ksImg_.bendaharaSign=s.bendaharaSign; _ksShowPrev_('ksBendaharaPrev', s.bendaharaSign); }
    if(s.ketuaSign){ _ksImg_.ketuaSign=s.ketuaSign; _ksShowPrev_('ksKetuaPrev', s.ketuaSign); }
  }).catch(function(){});
}
function closeKasSettings(){ document.getElementById('kasSettingsModal').classList.add('hidden'); }
function saveKasSettings(){
  var btn = document.getElementById('ksSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px"><svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Menyimpan...</span>';
  var payload = {
    bendaharaName: document.getElementById('ksBendaharaName').value.trim(),
    ketuaName: document.getElementById('ksKetuaName').value.trim(),
    logo: _ksImg_.logo || '',
    bendaharaSign: _ksImg_.bendaharaSign || '',
    ketuaSign: _ksImg_.ketuaSign || ''
  };
  gasPost_('adminSetKasSettings', { payload: payload }).then(function(){
    btn.disabled=false; btn.innerText='Simpan';
    closeKasSettings(); showToast('Pengaturan tersimpan','success');
    _kasSettingsCache = payload;
  }).catch(function(){ btn.disabled=false; btn.innerText='Simpan'; showToast('Gagal menyimpan','error'); });
}

/* ================= LAPORAN KAS (Home, realtime warga) ================= */
var _kasReportCache = {};   // { year: report }
var _kasSettingsCache = null;
var _kasPdfMonth_ = null;   // bulan terpilih utk unduh PDF (null = default bulan berjalan)
var _kasReportYear_ = null;
function _kasRpFull_(n){ return 'Rp ' + Number(n||0).toLocaleString('id-ID'); }
// "2026-05-25" → "25 Mei 2026"
function _kasFmtTgl_(s){
  var m = String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return String(s||'');
  var MN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return parseInt(m[3],10) + ' ' + (MN[parseInt(m[2],10)-1]||'') + ' ' + m[1];
}
function _kasRpShort_(n){ n=Number(n||0); var sg=n<0?'-':''; var a=Math.abs(n); var s; if(a>=1000000) s='Rp '+(a/1000000).toFixed(1).replace('.',',')+' Jt'; else if(a>=1000) s='Rp '+Math.round(a/1000)+' Rb'; else s='Rp '+a.toLocaleString('id-ID'); return sg+s; }

// Loader getKasReport bersama — cegah request ganda saat saldo & aktivitas terbaru dimuat bersamaan
var _kasReportLoadingPromise_ = null;
function _loadKasReportShared_(){
  var anyYear = Object.keys(_kasReportCache)[0];
  if(anyYear) return Promise.resolve(_kasReportCache[anyYear]);
  if(_kasReportLoadingPromise_) return _kasReportLoadingPromise_;
  _kasReportLoadingPromise_ = gasGet_('getKasReport', {}).then(function(res){
    _kasReportLoadingPromise_ = null;
    if(res && res.ok){ _kasReportCache[res.year] = res; _kasReportYear_ = _kasReportYear_ || res.year; }
    return res;
  }).catch(function(err){ _kasReportLoadingPromise_ = null; throw err; });
  return _kasReportLoadingPromise_;
}

// Kartu saldo di Home (masked jika belum login)
function _renderSaldoKasCard_(){
  var mini = document.getElementById('homeSaldoEfektifMini');
  if(!mini) return;
  if(!currentUser){
    mini.textContent = '*****';
    return;
  }
  var anyYear = Object.keys(_kasReportCache)[0];
  if(anyYear){ _applySaldoCard_(_kasReportCache[anyYear]); return; }
  mini.textContent = 'memuat…';
  _loadKasReportShared_().then(function(res){
    if(res && res.ok) _applySaldoCard_(res);
    else mini.textContent = '—';
  }).catch(function(){
    mini.textContent = '—';
  });
}
function _applySaldoCard_(res){
  var mini = document.getElementById('homeSaldoEfektifMini');
  if(!res) return;
  if(mini) mini.textContent = _kasRpShort_(res.saldoEfektif);
}

// Kartu Aktivitas Terbaru di Home (publik, tidak perlu login)
function _renderKasTransparansi_(){
  var list = document.getElementById('aktivitasTerbaruList');
  if(!list) return;

  var anyYear = Object.keys(_kasReportCache)[0];
  if(anyYear){ _renderAktivitasTerbaru_(_kasReportCache[anyYear]); return; }

  list.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Memuat...</p>';

  _loadKasReportShared_().then(function(res){
    if(res && res.ok) _renderAktivitasTerbaru_(res);
    else list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>';
  }).catch(function(){ list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>'; });
}

// Donut "Transparansi Kas" — dipakai di dalam modal Laporan Kas
function _kasTransparansiHtml_(res){
  var masuk = res.masukAll || 0;
  var keluar = res.keluarAll || 0;
  var totalFlow = masuk + keluar;
  var pct = totalFlow > 0 ? Math.round((masuk / totalFlow) * 100) : 0;

  return '<div class="bg-white rounded-2xl border border-gray-100 p-3">'+
    '<p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Transparansi Kas</p>'+
    '<div class="flex items-center gap-5">'+
      '<div class="relative flex-shrink-0 w-20 h-20">'+
        '<svg viewBox="0 0 36 36" class="w-20 h-20" style="transform:rotate(-90deg);">'+
          '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="#FEE2E2" stroke-width="3.5"></circle>'+
          '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="#2563eb" stroke-width="3.5" '+
            'stroke-linecap="round" stroke-dasharray="'+pct+' '+(100-pct)+'"></circle>'+
        '</svg>'+
        '<div class="absolute inset-0 flex flex-col items-center justify-center">'+
          '<p class="text-sm font-black text-gray-900">'+pct+'%</p>'+
          '<p class="text-[8px] text-gray-400 uppercase tracking-wide">Masuk</p>'+
        '</div>'+
      '</div>'+
      '<div class="flex-1 space-y-2">'+
        '<div class="flex items-center justify-between">'+
          '<div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span><span class="text-xs text-gray-500">Pemasukan</span></div>'+
          '<span class="text-sm font-bold text-blue-600">'+_kasRpShort_(masuk)+'</span>'+
        '</div>'+
        '<div class="flex items-center justify-between">'+
          '<div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-red-400"></span><span class="text-xs text-gray-500">Pengeluaran</span></div>'+
          '<span class="text-sm font-bold text-red-500">'+_kasRpShort_(keluar)+'</span>'+
        '</div>'+
        '<div class="flex items-center justify-between pt-2 border-t border-gray-50">'+
          '<span class="text-xs text-gray-500">Saldo Efektif</span>'+
          '<span class="text-sm font-bold '+(res.saldoEfektif>=0?'text-gray-900':'text-red-600')+'">'+_kasRpShort_(res.saldoEfektif)+'</span>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

// Daftar "Info Kas IPL" (laporan per tahun) — dipakai di bagian bawah modal Laporan Kas
function _kasInfoIplListHtml_(){
  var years = [
    { y:'2026', label:'Laporan per bulan', badge:'Terbaru', bg:'#EFF6FF', stroke:'#2563EB' },
    { y:'2025', label:'Laporan tahunan', badge:null, bg:'#eff6ff', stroke:'#2563eb' },
    { y:'2024', label:'Laporan tahunan', badge:null, bg:'#FFF7ED', stroke:'#EA580C' },
    { y:'2023', label:'Laporan tahunan', badge:null, bg:'#F5F3FF', stroke:'#7C3AED' }
  ];
  var rows = years.map(function(item){
    var badge = item.badge
      ? '<span class="text-[10px] font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">'+item.badge+'</span>'
      : '';
    return '<button onclick="openKasIPL(\''+item.y+'\')" class="w-full px-3 py-3 flex items-center gap-3 active:bg-gray-50 transition text-left">'+
      '<div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style="background:'+item.bg+';">'+
        '<svg class="w-4 h-4" fill="none" stroke="'+item.stroke+'" stroke-width="1.8" viewBox="0 0 24 24">'+
          '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'+
          '<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'+
        '</svg>'+
      '</div>'+
      '<div class="flex-1 min-w-0">'+
        '<p class="text-sm font-semibold text-gray-900">Kas IPL '+item.y+'</p>'+
        '<p class="text-xs text-gray-400 mt-0.5">'+item.label+'</p>'+
      '</div>'+
      '<div class="flex items-center gap-1.5 flex-shrink-0">'+badge+
        '<svg class="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>'+
      '</div>'+
    '</button>';
  }).join('');

  return '<div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">'+
    '<div class="px-3 pt-3 flex items-center justify-between">'+
      '<p class="text-xs font-bold text-gray-500 uppercase tracking-wide">Info Kas IPL</p>'+
      '<div class="flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-full">'+
        '<svg class="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'+
        '<span class="text-[11px] text-blue-600 font-semibold">Publik</span>'+
      '</div>'+
    '</div>'+
    '<div class="divide-y divide-gray-50 mt-1">'+rows+'</div>'+
  '</div>';
}

var _aktivitasTerbaruExpanded_ = false;

function _renderAktivitasTerbaru_(res){
  var list = document.getElementById('aktivitasTerbaruList');
  var moreList = document.getElementById('aktivitasTerbaruMoreList');
  var toggle = document.getElementById('aktivitasTerbaruToggle');
  if(!list) return;

  var items = [];
  (res.incomes || []).forEach(function(it){
    items.push({
      tanggal: it.tanggal,
      judul: it.kategori || 'Pemasukan',
      sub: it.blok ? ('Blok ' + it.blok) : (it.periode || ''),
      nominal: it.nominal,
      type: 'in'
    });
  });
  (res.expenses || []).forEach(function(it){
    items.push({
      tanggal: it.tanggal,
      judul: it.kategori || 'Pengeluaran',
      sub: it.sub || it.keterangan || '',
      nominal: it.nominal,
      type: 'out'
    });
  });

  items.sort(function(a, b){ return new Date(b.tanggal) - new Date(a.tanggal); });
  items = items.slice(0, 10);

  if(!items.length){
    list.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada transaksi.</p>';
    if(moreList){ moreList.innerHTML = ''; moreList.classList.add('hidden'); }
    if(toggle) toggle.classList.add('hidden');
    return;
  }

  var isGuest = !currentUser;

  // Mask data sensitif (nominal & blok) bila belum login
  function _maskSub_(sub){
    sub = String(sub || '');
    if(/^Blok/i.test(sub)) return 'Blok ••';
    return '••••';
  }

  var renderItem = function(it){
    var isIn = it.type === 'in';
    var icon = isIn
      ? '<svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>'
      : '<svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12l7 7 7-7"/></svg>';
    var subTxt = isGuest ? _maskSub_(it.sub) : escapeHtml_(it.sub);
    var nominalTxt = isGuest ? 'Rp •••' : _kasRpShort_(it.nominal);
    return '<div class="px-4 py-3 flex items-center gap-3">'+
      '<div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style="background:'+(isIn?'#eff6ff':'#FEF2F2')+';">'+icon+'</div>'+
      '<div class="flex-1 min-w-0">'+
        '<p class="text-sm font-semibold text-gray-900 truncate">'+escapeHtml_(it.judul)+'</p>'+
        '<p class="text-[11px] text-gray-400 truncate">'+subTxt+' · '+_kasFmtTgl_(it.tanggal)+'</p>'+
      '</div>'+
      '<p class="text-sm font-bold flex-shrink-0 '+(isIn?'text-blue-600':'text-red-500')+'">'+(isIn?'+':'-')+nominalTxt+'</p>'+
    '</div>';
  };

  // Guest: hanya 3 item, sisanya TIDAK dirender (cegah kebocoran data), klik = login
  var visible = items.slice(0, 3);
  var rest = isGuest ? [] : items.slice(3);

  list.innerHTML = visible.map(renderItem).join('');

  if(moreList){
    if(rest.length){
      moreList.innerHTML = rest.map(renderItem).join('');
      moreList.classList.toggle('hidden', !_aktivitasTerbaruExpanded_);
    } else {
      moreList.innerHTML = '';
      moreList.classList.add('hidden');
    }
  }
  if(toggle){
    // Guest: tombol tetap tampil → klik minta login. Member: tampil bila ada sisa.
    toggle.classList.toggle('hidden', !isGuest && !rest.length);
    _setAktivitasToggleLabel_();
  }
}

function _setAktivitasToggleLabel_(){
  var label = document.getElementById('aktivitasTerbaruToggleLabel');
  var icon = document.getElementById('aktivitasTerbaruToggleIcon');
  if(!currentUser){
    if(label) label.textContent = 'Login untuk lihat lebih banyak';
    if(icon) icon.style.display = 'none';
    return;
  }
  if(icon) icon.style.display = '';
  if(label) label.textContent = _aktivitasTerbaruExpanded_ ? 'Tampilkan lebih sedikit' : 'Lihat lebih banyak';
  if(icon) icon.style.transform = _aktivitasTerbaruExpanded_ ? 'rotate(180deg)' : '';
}

function _toggleAktivitasMore_(){
  // Belum login → minta login, jangan expand
  if(!currentUser){
    if(typeof openLoginRequiredModal === 'function') openLoginRequiredModal('Login untuk melihat seluruh aktivitas kas.');
    return;
  }
  var moreList = document.getElementById('aktivitasTerbaruMoreList');
  _aktivitasTerbaruExpanded_ = !_aktivitasTerbaruExpanded_;
  if(moreList) moreList.classList.toggle('hidden', !_aktivitasTerbaruExpanded_);
  _setAktivitasToggleLabel_();
}

function openKasReport(){
  if(!currentUser){ if(typeof openLoginRequiredModal==='function') openLoginRequiredModal('Login untuk melihat laporan kas.'); return; }
  document.getElementById('kasReportModal').classList.remove('hidden');
  document.getElementById('kasReportBody').innerHTML =
    '<div class="flex flex-col gap-3 pt-1"><div class="skeleton rounded-2xl w-full" style="height:84px;"></div><div class="skeleton rounded-2xl w-full" style="height:240px;"></div></div>';
  _loadKasReport_(_kasReportYear_ || '');
}
function closeKasReport(){ document.getElementById('kasReportModal').classList.add('hidden'); }

function _loadKasReport_(year){
  if(year && _kasReportCache[year]){ _kasReportYear_ = year; _renderKasReport_(_kasReportCache[year]); return; }
  gasGet_('getKasReport', year ? { year: year } : {}).then(function(res){
    if(res && res.ok){ _kasReportCache[res.year] = res; _kasReportYear_ = res.year; _renderKasReport_(res); }
    else { document.getElementById('kasReportBody').innerHTML = '<div class="text-center text-red-400 text-sm py-8">Gagal memuat laporan.</div>'; }
  }).catch(function(){ document.getElementById('kasReportBody').innerHTML = '<div class="text-center text-red-400 text-sm py-8">Gagal memuat laporan.</div>'; });
}
function _kasSetYear_(y){ _loadKasReport_(parseInt(y,10)); }

function _renderKasReport_(res){
  var body = document.getElementById('kasReportBody');
  var sub = document.getElementById('kasReportSub');
  if(sub) sub.textContent = 'Tahun ' + res.year + ' · per ' + res.generatedAt;

  var yearSel = (res.years && res.years.length > 1)
    ? '<select onchange="_kasSetYear_(this.value)" class="app-input text-sm" style="width:auto;padding:4px 10px">'+res.years.map(function(y){return '<option value="'+y+'"'+(y===res.year?' selected':'')+'>'+y+'</option>';}).join('')+'</select>'
    : '<span class="text-sm font-bold text-gray-900">'+res.year+'</span>';

  var summary =
    '<div class="flex items-center justify-between mb-1"><p class="text-xs font-bold text-gray-500 uppercase tracking-wide">Ringkasan</p>'+yearSel+'</div>'+
    '<div class="bg-white rounded-2xl border border-gray-100 p-3 grid grid-cols-3 divide-x divide-gray-100">'+
      '<div class="px-2 text-center"><p class="text-[10px] text-gray-400 uppercase">Masuk</p><p class="text-sm font-black text-blue-600 mt-1 whitespace-nowrap">'+_kasRpShort_(res.masukAll)+'</p></div>'+
      '<div class="px-2 text-center"><p class="text-[10px] text-gray-400 uppercase">Keluar</p><p class="text-sm font-black text-red-500 mt-1 whitespace-nowrap">'+_kasRpShort_(res.keluarAll)+'</p></div>'+
      '<div class="px-2 text-center"><p class="text-[10px] text-gray-400 uppercase">Saldo</p><p class="text-sm font-black '+(res.saldoEfektif>=0?'text-gray-900':'text-red-600')+' mt-1 whitespace-nowrap">'+_kasRpShort_(res.saldoEfektif)+'</p></div>'+
    '</div>';

  var rows = res.months.map(function(m){
    if(!m.masuk && !m.keluar) return '';
    var keluarCell = m.keluar
      ? '<button onclick="_kasShowDetail_(\'month\','+m.idx+')" class="text-red-500 font-semibold underline decoration-dotted underline-offset-2">'+_kasRpFull_(m.keluar)+'</button>'
      : '<span class="text-gray-300">-</span>';
    var masukCell = m.masuk
      ? '<button onclick="_kasShowDetail_(\'monthIn\','+m.idx+')" class="text-blue-600 font-semibold underline decoration-dotted underline-offset-2">'+_kasRpFull_(m.masuk)+'</button>'
      : '<span class="text-gray-300">-</span>';
    return '<tr class="border-t border-gray-50">'+
      '<td class="py-1.5 text-gray-600">'+m.label+'</td>'+
      '<td class="py-1.5 text-right">'+masukCell+'</td>'+
      '<td class="py-1.5 text-right">'+keluarCell+'</td>'+
      '<td class="py-1.5 text-right font-semibold '+(m.saldoRun>=0?'text-gray-700':'text-red-600')+'">'+_kasRpFull_(m.saldoRun)+'</td>'+
    '</tr>';
  }).join('');
  if(!rows) rows = '<tr><td colspan="4" class="py-4 text-center text-gray-400">Belum ada transaksi tahun ini.</td></tr>';
  var table =
    '<div class="bg-white rounded-2xl border border-gray-100 p-3 overflow-x-auto">'+
      '<p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Arus Kas Bulanan '+res.year+'</p>'+
      '<table class="w-full text-[11px]"><thead><tr class="text-gray-400"><th class="text-left font-semibold">Bulan</th><th class="text-right font-semibold">Masuk</th><th class="text-right font-semibold">Keluar</th><th class="text-right font-semibold">Saldo</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '</div>';

  var kats = Object.keys(res.byKategori||{}).sort(function(a,b){return res.byKategori[b]-res.byKategori[a];});
  var catBlock = kats.length
    ? '<div class="bg-white rounded-2xl border border-gray-100 p-3"><p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pengeluaran per Kategori '+res.year+'</p>'+kats.map(function(k){var kEsc=k.replace(/'/g,"\\'");return '<button onclick="_kasShowDetail_(\'kat\',\''+kEsc+'\')" class="w-full flex justify-between items-center text-xs py-1.5 active:opacity-60"><span class="text-gray-600 flex items-center gap-1">'+k+'<svg class="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span><span class="font-semibold text-gray-700">'+_kasRpFull_(res.byKategori[k])+'</span></button>';}).join('')+'</div>'
    : '';

  var katsIn = Object.keys(res.byKategoriMasuk||{}).sort(function(a,b){return res.byKategoriMasuk[b]-res.byKategoriMasuk[a];});
  var catBlockIn = katsIn.length
    ? '<div class="bg-white rounded-2xl border border-gray-100 p-3"><p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pemasukan per Kategori '+res.year+'</p>'+katsIn.map(function(k){var kEsc=k.replace(/'/g,"\\'");return '<button onclick="_kasShowDetail_(\'katIn\',\''+kEsc+'\')" class="w-full flex justify-between items-center text-xs py-1.5 active:opacity-60"><span class="text-gray-600 flex items-center gap-1">'+k+'<svg class="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span><span class="font-semibold text-blue-700">'+_kasRpFull_(res.byKategoriMasuk[k])+'</span></button>';}).join('')+'</div>'
    : '';

  var awalLine = (res.saldoAwal && res.saldoAwal !== 0)
    ? '<p class="text-[10px] text-gray-400 text-center">Termasuk saldo awal '+_kasRpFull_(res.saldoAwal)+'</p>'
    : '';
  var note = awalLine + '<p class="text-[10px] text-gray-400 text-center leading-relaxed px-2">Laporan otomatis & realtime. Tap nominal/kategori untuk lihat rincian & bukti.</p>';
  var transparansiBlock = _kasTransparansiHtml_(res);
  var infoKasIplBlock = _kasInfoIplListHtml_();
  body.innerHTML = summary + table + transparansiBlock + catBlockIn + catBlock + note + infoKasIplBlock;

  // Populate dropdown bulan untuk Unduh PDF (hanya bulan yang ada transaksi)
  var sel = document.getElementById('kasPdfMonth');
  if(sel){
    var avail = res.months.filter(function(m){ return m.masuk || m.keluar; });
    if(!avail.length){
      sel.innerHTML = '<option value="">— tahun '+res.year+' —</option>';
      _kasPdfMonth_ = -1;
    } else {
      var now = new Date();
      var defM = (res.year === now.getFullYear() && (res.months[now.getMonth()].masuk||res.months[now.getMonth()].keluar))
        ? now.getMonth() : avail[avail.length-1].idx;
      _kasPdfMonth_ = defM;
      sel.innerHTML = avail.map(function(m){
        return '<option value="'+m.idx+'"'+(m.idx===defM?' selected':'')+'>'+m.label+' '+res.year+'</option>';
      }).join('');
    }
  }
}

// Rincian transaksi (klik nominal Masuk/Keluar / kategori) — transparansi
function _kasShowDetail_(type, key){
  var res = _kasReportCache[_kasReportYear_];
  if(!res) return;
  var body = document.getElementById('kasReportBody');
  var isIncome = (type === 'monthIn' || type === 'katIn');
  var title, items, total;

  if(type === 'monthIn'){
    var miI = Number(key);
    items = (res.incomes || []).filter(function(e){ return e.monthIdx === miI; });
    title = (res.months[miI] ? res.months[miI].label : '') + ' ' + res.year;
  } else if(type === 'katIn'){
    items = (res.incomes || []).filter(function(e){ return (e.manual ? (e.kategori||'Lain-lain') : 'Iuran IPL') === key; });
    title = key + ' · ' + res.year;
  } else if(type === 'month'){
    var mi = Number(key);
    items = (res.expenses || []).filter(function(e){ return e.monthIdx === mi; });
    title = (res.months[mi] ? res.months[mi].label : '') + ' ' + res.year;
  } else {
    items = (res.expenses || []).filter(function(e){ return e.kategori === key; });
    title = key + ' · ' + res.year;
  }
  total = items.reduce(function(s,e){ return s + Number(e.nominal||0); }, 0);

  var accent = isIncome ? 'text-blue-700' : 'text-red-600';
  // Kartu total dibedakan warnanya dari kartu rincian (yg putih) — tinted
  var totalCardStyle = isIncome
    ? 'background:#eff6ff;border:1px solid #bfdbfe;'
    : 'background:#FEF2F2;border:1px solid #FECACA;';
  var head =
    '<div class="flex items-center justify-between mb-1">' +
      '<button onclick="_renderKasReport_(_kasReportCache[_kasReportYear_])" class="flex items-center gap-0.5 text-xs font-semibold text-primary active:opacity-60"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Kembali</button>' +
      '<span class="text-xs font-bold text-gray-500 uppercase tracking-wide">Rincian ' + (isIncome ? 'Masuk' : 'Keluar') + '</span>' +
    '</div>' +
    '<div class="rounded-2xl p-3 flex items-center justify-between" style="'+totalCardStyle+'">' +
      '<span class="text-sm font-bold text-gray-900">'+title+'</span>' +
      '<span class="text-base font-black '+accent+'">'+_kasRpFull_(total)+'</span>' +
    '</div>';

  var list;
  if(!items.length){
    list = '<p class="text-sm text-gray-400 text-center py-6">Tidak ada rincian.</p>';
  } else if(isIncome){
    list = items.map(function(e){
      var inner;
      if(e.manual){
        // Pemasukan manual (donasi/sumbangan/dll) — label kategori + keterangan
        inner =
          '<p class="text-sm font-semibold text-gray-900 truncate">'+_escHtml_(e.kategori || e.blok || 'Pemasukan')+'</p>' +
          (e.periode ? '<p class="text-[11px] text-gray-500 mt-0.5">'+_escHtml_(e.periode)+'</p>' : '') +
          '<p class="text-[11px] text-gray-400 mt-0.5">Diterima '+_kasFmtTgl_(e.tanggal)+'</p>';
      } else {
        var lateBadge = e.late ? ' <span class="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full align-middle">Telat</span>' : '';
        inner =
          '<p class="text-sm font-semibold text-gray-900 truncate">Blok '+_escHtml_(e.blok)+lateBadge+'</p>' +
          '<p class="text-[11px] text-gray-400 mt-0.5">Periode '+_escHtml_(e.periode||'-')+'</p>' +
          '<p class="text-[11px] text-gray-400 mt-0.5">Dibayar '+_kasFmtTgl_(e.tanggal)+(e.due?(' · jatuh tempo '+_kasFmtTgl_(e.due)):'')+'</p>';
      }
      return '<div class="bg-white rounded-2xl border border-gray-100 p-3 flex items-start justify-between gap-2">' +
        '<div class="min-w-0">' + inner + '</div>' +
        '<span class="text-sm font-black text-blue-600 flex-shrink-0">'+_kasRpFull_(e.nominal)+'</span>' +
      '</div>';
    }).join('');
  } else {
    list = items.map(function(e){
      var sub = e.sub ? ' · ' + e.sub : '';
      return '<div class="bg-white rounded-2xl border border-gray-100 p-3">' +
        '<div class="flex items-start justify-between gap-2">' +
          '<div class="min-w-0">' +
            '<p class="text-sm font-semibold text-gray-900 truncate">'+_escHtml_(e.kategori)+'<span class="font-normal text-gray-400">'+_escHtml_(sub)+'</span></p>' +
            '<p class="text-[11px] text-gray-400 mt-0.5">'+_kasFmtTgl_(e.tanggal)+(e.metode?(' · '+_escHtml_(e.metode)):'')+'</p>' +
            (e.keterangan ? '<p class="text-[11px] text-gray-500 mt-0.5">'+_escHtml_(e.keterangan)+'</p>' : '') +
          '</div>' +
          '<span class="text-sm font-black text-red-500 flex-shrink-0">'+_kasRpFull_(e.nominal)+'</span>' +
        '</div>' +
        '<div class="mt-2 pt-2 border-t border-gray-50">' +
          (e.buktiUrl
            ? '<button class="lihat-bukti-btn text-[11px] font-semibold text-gray-500 px-2.5 py-1 rounded-lg bg-gray-100" data-bukti="'+e.buktiUrl+'">Lihat Bukti</button>'
            : '<span class="text-[10px] text-gray-300">Tanpa bukti</span>') +
        '</div>' +
      '</div>';
    }).join('');
  }

  body.innerHTML = '<div class="space-y-2">' + head + list + '</div>';
}

function _kasPdfBtnBusy_(busy){
  var btn = document.getElementById('kasPdfBtn');
  if(!btn) return;
  if(busy){
    if(!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px"><svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Menyiapkan…</span>';
  } else {
    btn.disabled = false;
    if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
  }
}
function _kasDownloadPDF_(){
  var res = _kasReportCache[_kasReportYear_];
  if(!res){ showToast('Laporan belum siap','error'); return; }
  _kasPdfBtnBusy_(true);   // feedback langsung
  if(_kasSettingsCache){ _kasBuildPDF_(res, _kasSettingsCache); return; }
  gasGet_('getKasSettings').then(function(r){ _kasSettingsCache = (r&&r.settings)?r.settings:{}; _kasBuildPDF_(res, _kasSettingsCache); })
    .catch(function(){ _kasBuildPDF_(res, {}); });
}
function _kasBuildPDF_(res, settings){
  settings = settings || {};
  var rows = res.months.filter(function(m){return m.masuk||m.keluar;}).map(function(m){
    return '<tr><td>'+m.label+' '+res.year+'</td><td style="text-align:right;color:#2563eb">'+(m.masuk?_kasRpFull_(m.masuk):'-')+'</td><td style="text-align:right;color:#dc2626">'+(m.keluar?_kasRpFull_(m.keluar):'-')+'</td><td style="text-align:right">'+_kasRpFull_(m.saldoRun)+'</td></tr>';
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:#999">Belum ada transaksi</td></tr>';
  var kats = Object.keys(res.byKategori||{}).sort(function(a,b){return res.byKategori[b]-res.byKategori[a];});
  var catRows = kats.map(function(k){return '<tr><td>'+k+'</td><td style="text-align:right">'+_kasRpFull_(res.byKategori[k])+'</td></tr>';}).join('');
  var katsIn = Object.keys(res.byKategoriMasuk||{}).sort(function(a,b){return res.byKategoriMasuk[b]-res.byKategoriMasuk[a];});
  var catRowsIn = katsIn.map(function(k){return '<tr><td>'+k+'</td><td style="text-align:right;color:#2563eb">'+_kasRpFull_(res.byKategoriMasuk[k])+'</td></tr>';}).join('');

  // Rincian transaksi di PDF — fokus BULAN BERJALAN (kalau tahun = tahun sekarang)
  var _MN_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  var nowD = new Date();
  var _defMonth = (res.year === nowD.getFullYear()) ? nowD.getMonth() : -1;
  var detailMonth = (typeof _kasPdfMonth_ === 'number') ? _kasPdfMonth_ : _defMonth; // bulan terpilih utk download
  var inMonth = function(e){ return detailMonth < 0 || e.monthIdx === detailMonth; };
  var monthTitle = detailMonth >= 0 ? (' — ' + _MN_FULL[detailMonth] + ' ' + res.year) : (' (Semua Bulan ' + res.year + ')');

  var expSel = (res.expenses || []).filter(inMonth);
  var expDetailRows = expSel.map(function(e){
    return '<tr><td>'+_kasFmtTgl_(e.tanggal)+'</td><td>'+e.kategori+(e.sub?' · '+e.sub:'')+'</td><td>'+(e.keterangan||'-')+'</td><td style="text-align:right;color:#dc2626">'+_kasRpFull_(e.nominal)+'</td></tr>';
  }).join('');

  var incSel = (res.incomes || []).filter(inMonth);
  var incDetailRows = incSel.map(function(e){
    var lt = e.late ? ' <span style="color:#dc2626;font-weight:700">· Telat</span>' : '';
    var srcLabel = e.manual ? (e.kategori || 'Pemasukan') : ('Blok ' + e.blok);
    return '<tr><td>'+_kasFmtTgl_(e.tanggal)+'</td><td>'+srcLabel+'</td><td>'+(e.periode||'-')+lt+'</td><td style="text-align:right;color:#2563eb">'+_kasRpFull_(e.nominal)+'</td></tr>';
  }).join('');

  // Jejak pencetak (untuk watermark + footer)
  var _who = (typeof currentUser!=='undefined' && currentUser && currentUser.fullName) ? currentUser.fullName : 'Pengguna';
  var _blokWho = '';
  if(typeof currentUser!=='undefined' && currentUser){
    if(currentUser.wargaData && currentUser.wargaData[0] && currentUser.wargaData[0].blok) _blokWho = currentUser.wargaData[0].blok;
    else if(currentUser.blocks && currentUser.blocks.length) _blokWho = currentUser.blocks.join(', ');
  }
  var printedBy = _escHtml_(_who + (_blokWho ? ' ('+_blokWho+')' : ''));

  // Ringkasan penagihan + tunggakan + net + saldo awal (mengikuti bulan terpilih)
  var collMi = detailMonth;
  var paidM = (res.paidByMonth && collMi>=0) ? (res.paidByMonth[collMi]||0) : (res.paidThisMonth||0);
  var rate = res.totalRumah ? Math.round((paidM/res.totalRumah)*100) : 0;
  var pRows = '';
  if(collMi>=0){
    pRows += '<div class="prow"><span>Penagihan '+_MN_FULL[collMi]+' '+res.year+'</span><span><b>'+paidM+'/'+(res.totalRumah||0)+' rumah ('+rate+'%)</b></span></div>';
    var mc = res.months[collMi] || {masuk:0,keluar:0};
    pRows += '<div class="prow"><span>Net '+_MN_FULL[collMi]+'</span><span><span style="color:#2563eb">+'+_kasRpFull_(mc.masuk)+'</span> / <span style="color:#dc2626">−'+_kasRpFull_(mc.keluar)+'</span></span></div>';
  }
  pRows += '<div class="prow"><span>Total tunggakan</span><span><b>'+(res.tunggakanHouses||0)+' rumah · '+(res.tunggakanMonths||0)+' bulan</b>'+(res.tunggakanAmount?(' · '+_kasRpFull_(res.tunggakanAmount)):'')+'</span></div>';
  if(res.saldoAwal){ pRows += '<div class="prow"><span>Saldo awal (migrasi)</span><span><b>'+_kasRpFull_(res.saldoAwal)+'</b></span></div>'; }
  var penagihanBox = '<div class="pbox">'+pRows+'</div>';

  var _sigImg = function(src){ return src ? '<img src="'+src+'" style="max-height:54px;max-width:170px;object-fit:contain">' : ''; };
  var _nameLine = function(n){ return n ? '<br><b style="color:#111">'+_escHtml_(n)+'</b>' : ''; };
  var signatures = '<div class="sign">'+
    '<div class="sb"><div class="sp">'+_sigImg(settings.bendaharaSign)+'</div><div class="sl">Bendahara'+_nameLine(settings.bendaharaName)+'</div></div>'+
    '<div class="sb"><div class="sp">'+_sigImg(settings.ketuaSign)+'</div><div class="sl">Ketua'+_nameLine(settings.ketuaName)+'</div></div>'+
  '</div>';

  // Watermark tiled — pakai elemen DOM (background-image tidak ikut tercetak by default)
  var _wmRaw = _escHtml_(_who + (_blokWho ? ' ('+_blokWho+')' : ''));
  var _wmCells = '';
  for(var _wy=20; _wy<1180; _wy+=160){
    for(var _wx=-40; _wx<840; _wx+=250){
      _wmCells += '<span style="position:absolute;left:'+_wx+'px;top:'+_wy+'px;transform:rotate(-30deg);transform-origin:left top;font:700 19px Arial;color:#000;opacity:0.06;white-space:nowrap">'+_wmRaw+'</span>';
    }
  }
  var wmLayer = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;overflow:hidden;z-index:0;pointer-events:none">'+_wmCells+'</div>';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Kas '+res.year+'</title>'+
    '<style>*{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}body{padding:24px;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:18px;margin:0}'+
    '.sub{color:#666;font-size:12px;margin:2px 0 16px}.cards{display:flex;gap:10px;margin-bottom:12px}'+
    '.card{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:10px;text-align:center}.card .l{font-size:10px;color:#888;text-transform:uppercase}.card .v{font-size:15px;font-weight:800;margin-top:4px}'+
    'h3{font-size:13px;margin:14px 0 6px}table{width:100%;border-collapse:collapse;font-size:12px}'+
    'th,td{padding:6px 8px;border-bottom:1px solid #eee}th{text-align:left;color:#666;font-size:10px;text-transform:uppercase}'+
    '.pbox{border:1px solid #e5e7eb;border-radius:10px;padding:6px 12px;margin-bottom:16px;font-size:12px}'+
    '.prow{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f5f5f5}.prow:last-child{border-bottom:0}'+
    '.sign{display:flex;justify-content:space-around;margin-top:40px}.sb{text-align:center;width:40%}.sp{height:58px;display:flex;align-items:flex-end;justify-content:center}.sl{border-top:1px solid #999;padding-top:4px;font-size:11px;color:#555;line-height:1.5}'+
    '.content{position:relative;z-index:1}'+
    '.foot{font-size:10px;color:#999;margin-top:14px}</style></head>'+
    '<body style="background:#fff">'+
    wmLayer+
    '<div class="content">'+
    (settings.logo
      ? '<div style="display:flex;align-items:center;gap:12px"><img src="'+settings.logo+'" style="height:46px;width:auto;object-fit:contain"><h1>Laporan Kas IPL — Jade Park Serpong 2</h1></div>'
      : '<h1>Laporan Kas IPL — Jade Park Serpong 2</h1>')+
    '<div class="sub">Tahun '+res.year+' · dibuat '+res.generatedAt+'</div>'+
    '<div class="cards"><div class="card"><div class="l">Masuk</div><div class="v" style="color:#2563eb">'+_kasRpFull_(res.masukAll)+'</div></div>'+
      '<div class="card"><div class="l">Keluar</div><div class="v" style="color:#dc2626">'+_kasRpFull_(res.keluarAll)+'</div></div>'+
      '<div class="card"><div class="l">Saldo Efektif</div><div class="v">'+_kasRpFull_(res.saldoEfektif)+'</div></div></div>'+
    penagihanBox+
    '<h3>Arus Kas Bulanan '+res.year+'</h3>'+
    '<table><thead><tr><th>Bulan</th><th style="text-align:right">Masuk</th><th style="text-align:right">Keluar</th><th style="text-align:right">Saldo</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    (catRowsIn?('<h3>Pemasukan per Kategori</h3><table><tbody>'+catRowsIn+'</tbody></table>'):'')+
    (catRows?('<h3>Pengeluaran per Kategori</h3><table><tbody>'+catRows+'</tbody></table>'):'')+
    (expDetailRows?('<h3>Rincian Pengeluaran'+monthTitle+'</h3><table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th style="text-align:right">Nominal</th></tr></thead><tbody>'+expDetailRows+'</tbody></table>'):'')+
    (incDetailRows?('<h3>Rincian Pemasukan'+monthTitle+'</h3><table><thead><tr><th>Tanggal</th><th>Sumber</th><th>Periode/Ket.</th><th style="text-align:right">Nominal</th></tr></thead><tbody>'+incDetailRows+'</tbody></table>'):'')+
    signatures+
    '<div class="foot">Rincian transaksi di atas untuk <b>'+(detailMonth>=0?('bulan '+_MN_FULL[detailMonth]+' '+res.year):('semua bulan '+res.year))+'</b>. Jatuh tempo IPL: <b>tgl 5 bulan berikutnya</b> ("Telat" = bayar setelah jatuh tempo). Untuk bulan/tahun lain, silakan cek aplikasi PWP.<br>Dicetak oleh: <b>'+printedBy+'</b> · '+res.generatedAt+'<br>Laporan otomatis & realtime dari PWP. Rekap final dilakukan pengurus di akhir bulan.</div>'+
    '</div>'+
    '</body></html>';
  _kasShowPdfPreview_(html);
}

// Preview laporan dalam overlay (mobile-friendly) + tombol simpan/cetak.
function _kasShowPdfPreview_(html){
  var ov = document.getElementById('kasPdfPreviewOverlay');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'kasPdfPreviewOverlay';
    ov.className = 'fixed inset-0 z-[950] hidden bg-black/50 flex items-end sm:items-center justify-center';
    ov.innerHTML =
      '<div class="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden jsheet flex flex-col">' +
        '<div class="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">' +
          '<div><p class="text-base font-bold text-gray-900">Preview Laporan</p><p class="text-[11px] text-gray-400">Cek dulu, lalu Simpan / Cetak PDF</p></div>' +
          '<button onclick="_kasClosePdfPreview_()" aria-label="Tutup" class="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 active:scale-90 transition flex-shrink-0"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="flex-1 overflow-hidden bg-gray-200"><iframe id="kasPdfPreviewFrame" class="w-full h-full border-0" title="Preview Laporan Kas" style="background:#fff"></iframe></div>' +
        '<div class="px-5 py-3 border-t border-gray-100 flex-shrink-0">' +
          '<button onclick="_kasPrintPreview_()" class="w-full py-3.5 rounded-2xl bg-primary text-white font-bold text-sm active:scale-95 transition flex items-center justify-center gap-2 shadow-md shadow-primary/20">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>Simpan / Cetak PDF</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
  }
  var frame = document.getElementById('kasPdfPreviewFrame');
  try { var doc = frame.contentWindow.document; doc.open(); doc.write(html); doc.close(); } catch(e){ frame.srcdoc = html; }
  ov.classList.remove('hidden');
  _kasPdfBtnBusy_(false);
}
function _kasClosePdfPreview_(){ var ov = document.getElementById('kasPdfPreviewOverlay'); if(ov) ov.classList.add('hidden'); }
function _kasPrintPreview_(){
  var frame = document.getElementById('kasPdfPreviewFrame');
  if(!frame){ return; }
  try { frame.contentWindow.focus(); frame.contentWindow.print(); }
  catch(e){ try { window.print(); } catch(e2){ showToast('Gunakan menu browser → Cetak / Simpan PDF','info'); } }
}

// Relokasi tiap modal CRUD ke dalam tab panel-nya → tampil inline (bukan popup)
function _initAdminInlineCRUD_() {
  var map = [
    { key: 'info',      modal: 'infoCRUDModal' },
    { key: 'warga',     modal: 'dataWargaCRUDModal' },
    { key: 'greeting',  modal: 'greetingCRUDModal' },
    { key: 'fasum',     modal: 'fasumCRUDModal' },
    { key: 'pengaduan', modal: 'adminPengaduanModal' },
    { key: 'pendaftar', modal: 'wargaBaruCRUDModal' },
    { key: 'kasipl',    modal: 'kasIplCRUDModal' }
  ];
  map.forEach(function(m) {
    var panel = document.querySelector('#adminPanels > [data-panel="' + m.key + '"]');
    var modal = document.getElementById(m.modal);
    if (!panel || !modal || modal.dataset.inlined) return;
    // Sembunyikan preview card (JANGAN dihapus) — loader-nya masih dibutuhkan
    // untuk mengisi scorecard di atas. Cukup disembunyikan secara visual.
    Array.prototype.forEach.call(panel.children, function(c) { c.classList.add('hidden'); });
    modal.classList.add('crud-inline');
    // sembunyikan tombol close (×) — tidak relevan saat inline
    modal.querySelectorAll('button[onclick^="close"]').forEach(function(b) { b.style.display = 'none'; });
    panel.appendChild(modal);
    modal.dataset.inlined = '1';
  });
}

function switchAdminTab(key) {
  // Scorecards ringkasan hanya tampil di tab Ringkasan → tab lain lebih luas
  var scRow = document.getElementById('adminScorecardsRow');
  if (scRow) scRow.classList.toggle('hidden', key !== 'ringkasan');

  document.querySelectorAll('#adminPanels > [data-panel]').forEach(function(el) {
    el.classList.toggle('hidden', el.getAttribute('data-panel') !== key);
  });
  var _activeBtn = null;
  document.querySelectorAll('#adminTabNav .admin-tab').forEach(function(b) {
    var isActive = b.getAttribute('data-tab') === key;
    b.classList.toggle('admin-tab-active', isActive);
    if (isActive) _activeBtn = b;
  });
  // Auto-scroll navbar horizontal (manual — lebih reliable drpd scrollIntoView krn sticky)
  if (_activeBtn) {
    var _nav = document.getElementById('adminTabNav');
    if (_nav) {
      requestAnimationFrame(function() {
        var navR = _nav.getBoundingClientRect();
        var bR   = _activeBtn.getBoundingClientRect();
        var delta = (bR.left - navR.left) - (_nav.clientWidth - _activeBtn.offsetWidth) / 2;
        try { _nav.scrollTo({ left: _nav.scrollLeft + delta, behavior: 'smooth' }); }
        catch(e) { _nav.scrollLeft = _nav.scrollLeft + delta; }
      });
    }
  }
  _adminCurrentTab_ = key;
  var loader = _ADMIN_TAB_LOADERS_[key];
  if (loader) { try { loader(); } catch(e) {} }
}
var _adminCurrentTab_ = 'ringkasan';

/* ── Broadcast pengumuman ke semua warga ── */
function openBroadcast() {
  var m = document.getElementById('broadcastModal');
  if (!m) return;
  var t = document.getElementById('broadcastTitle');
  var b = document.getElementById('broadcastBody');
  if (t) t.value = '';
  if (b) b.value = '';
  m.classList.remove('hidden');
  switchBroadcastTab('buat');
  setTimeout(function() { if (t) t.focus(); }, 50);
}

function switchBroadcastTab(tab) {
  var buatTab    = document.getElementById('broadcastTabBuat');
  var riwayatTab = document.getElementById('broadcastTabRiwayat');
  var footer     = document.getElementById('broadcastTabBuatFooter');
  var buatBtn    = document.getElementById('broadcastTabBuatBtn');
  var riwayatBtn = document.getElementById('broadcastTabRiwayatBtn');
  var isBuat = tab !== 'riwayat';

  if (buatTab)    buatTab.classList.toggle('hidden', !isBuat);
  if (riwayatTab) riwayatTab.classList.toggle('hidden', isBuat);
  if (footer)     footer.classList.toggle('hidden', !isBuat);

  if (buatBtn)    buatBtn.className    = 'flex-1 py-2 rounded-xl text-sm font-semibold transition ' + (isBuat ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400');
  if (riwayatBtn) riwayatBtn.className = 'flex-1 py-2 rounded-xl text-sm font-semibold transition ' + (!isBuat ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400');

  if (!isBuat) loadBroadcastHistory_();
}
function closeBroadcast() {
  var m = document.getElementById('broadcastModal');
  if (m) m.classList.add('hidden');
}
function sendBroadcast() {
  var t = document.getElementById('broadcastTitle');
  var b = document.getElementById('broadcastBody');
  var btn = document.getElementById('broadcastSendBtn');
  var chWebapp = document.getElementById('broadcastChannelWebapp');
  var chWa     = document.getElementById('broadcastChannelWa');
  var title = (t ? t.value : '').trim();
  var body  = (b ? b.value : '').trim();
  var sendWebapp = chWebapp ? chWebapp.checked : true;
  var sendWa     = chWa ? chWa.checked : false;
  if (!title) { showToast('Judul wajib diisi', 'error'); return; }
  if (!sendWebapp && !sendWa) { showToast('Pilih minimal satu channel', 'error'); return; }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px"><svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Mengirim...</span>';
  }
  gasPost_('adminAddPublicNotification', {
    payload: {
      adminEmail: currentUser ? currentUser.email : '',
      title: title,
      body: body,
      subType: 'info_cluster',
      channels: { webapp: sendWebapp, wa: sendWa }
    }
  })
    .then(function(res) {
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim ke Semua Warga'; }
      if (!res || !res.success) { showToast((res && res.error) || 'Gagal mengirim', 'error'); return; }
      _broadcastHistoryCache_ = null;
      closeBroadcast();
      if (sendWa && res.wa && !res.wa.success) {
        showToast('Terkirim ke web app, WA gagal: ' + (res.wa.error || 'unknown error'), 'error');
      } else {
        showToast('Pengumuman terkirim ke semua warga', 'success');
      }
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim ke Semua Warga'; }
      showToast('Gagal mengirim', 'error');
    });
}

function escapeHtml_(str) {
  return String(str || '').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* ── Riwayat pengumuman (audit log), cached agar tidak reload tiap dibuka ── */
var _broadcastHistoryCache_ = null;

function loadBroadcastHistory_(forceRefresh) {
  var list = document.getElementById('broadcastTabRiwayat');
  if (!list) return;

  if (_broadcastHistoryCache_ && !forceRefresh) {
    _renderBroadcastHistory_(_broadcastHistoryCache_);
    return;
  }

  list.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Memuat...</p>';

  gasPost_('getBroadcastHistory', { payload: { adminEmail: currentUser ? currentUser.email : '' } })
    .then(function(res) {
      if (!res || !res.success) {
        list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">' + ((res && res.error) || 'Gagal memuat riwayat') + '</p>';
        return;
      }
      _broadcastHistoryCache_ = res.history || [];
      _renderBroadcastHistory_(_broadcastHistoryCache_);
    })
    .catch(function() {
      list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat riwayat</p>';
    });
}

function _renderBroadcastHistory_(history) {
  var list = document.getElementById('broadcastTabRiwayat');
  if (!list) return;

  if (!history || !history.length) {
    list.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada pengumuman terkirim.</p>';
    return;
  }
  list.innerHTML = history.map(function(h) {
    var date = new Date(h.timestamp);
    var dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' ' + date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    var badges = '';
    if (h.channels.indexOf('webapp') !== -1) {
      var pushOk = h.pushSuccess === true;
      badges += '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ' + (pushOk ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500') + '">Web App'
        + (pushOk ? ' · ' + (h.pushRecipients || 0) + ' push' : '') + '</span>';
    }
    if (h.channels.indexOf('wa') !== -1) {
      var waOk = h.waSuccess === true;
      badges += '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ' + (waOk ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500') + '">WhatsApp'
        + ' · ' + (h.waSentTo || 0) + '/' + (h.waTotal || 0) + '</span>';
    }
    return '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-3.5">'
      + '<div class="flex items-start justify-between gap-2">'
      + '<p class="text-sm font-bold text-gray-900 leading-tight">' + escapeHtml_(h.title) + '</p>'
      + '<span class="text-[11px] text-gray-400 flex-shrink-0">' + dateStr + '</span>'
      + '</div>'
      + (h.body ? '<p class="text-xs text-gray-500 mt-1 leading-relaxed">' + escapeHtml_(h.body) + '</p>' : '')
      + '<div class="flex items-center justify-between mt-2.5">'
      + '<div class="flex items-center gap-1.5">' + badges + '</div>'
      + '<p class="text-[11px] text-gray-400">oleh ' + escapeHtml_(h.adminEmail) + '</p>'
      + '</div>'
      + '</div>';
  }).join('');
}

/* ── RINGKASAN: status rumah + total kas IPL per tahun ── */
var _adminSummaryCache = null;

function _fmtRp_(n) { return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID'); }

function loadAdminSummary() {
  var statusEl = document.getElementById('summaryStatusCards');
  var yearEl   = document.getElementById('summaryYearList');
  if (_adminSummaryCache) { _renderAdminSummary_(_adminSummaryCache); return; }
  if (statusEl) statusEl.innerHTML = ['','',''].map(function() {
    return '<div class="skeleton rounded-2xl" style="height:124px;"></div>';
  }).join('');
  if (yearEl) yearEl.innerHTML = [0,1,2,3].map(function() {
    return '<div class="skeleton rounded-xl" style="height:58px;"></div>';
  }).join('');
  gasGet_('getAdminSummary')
    .then(function(res) {
      if (!res || !res.ok) {
        if (statusEl) statusEl.innerHTML = '<p class="col-span-3 text-sm text-red-400 text-center py-4">Gagal memuat ringkasan.</p>';
        if (yearEl)   yearEl.innerHTML = '';
        return;
      }
      _adminSummaryCache = res;
      _renderAdminSummary_(res);
    })
    .catch(function() {
      if (statusEl) statusEl.innerHTML = '<p class="col-span-3 text-sm text-red-400 text-center py-4">Gagal memuat ringkasan.</p>';
    });
  loadAdminArrears();
}

/* ── Tunggakan / belum bayar ── */
var _adminArrearsCache = null;

function loadAdminArrears() {
  if (_adminArrearsCache) { _renderArrears_(_adminArrearsCache); return; }
  var h = document.getElementById('arrearsHouses');
  var a = document.getElementById('arrearsAmount');
  var m = document.getElementById('arrearsMonths');
  if (h) h.innerHTML = '<span class="skeleton inline-block rounded-md align-middle" style="width:44px;height:26px;"></span>';
  if (a) a.innerHTML = '<span class="skeleton inline-block rounded-md align-middle" style="width:96px;height:18px;"></span>';
  if (m) m.innerHTML = '<span class="skeleton inline-block rounded align-middle" style="width:120px;height:11px;"></span>';
  gasGet_('getArrearsSummary')
    .then(function(res) {
      if (!res || !res.ok) return;
      _adminArrearsCache = res;
      _renderArrears_(res);
    })
    .catch(function() {});
}

function _renderArrears_(res) {
  var h = document.getElementById('arrearsHouses');
  var a = document.getElementById('arrearsAmount');
  var m = document.getElementById('arrearsMonths');
  var o = document.getElementById('arrearsAsOf');
  if (h) h.textContent = res.totalHouses || 0;
  if (a) a.textContent = _fmtRp_(res.totalAmount || 0);
  if (m) m.textContent = (res.totalMonths || 0) + ' bulan · Lihat detail ›';
  if (o) o.textContent = res.asOf ? ('per ' + res.asOf) : '';
}

var _arrearsFilter_ = { year: '', q: '' };

function openArrearsDetail() {
  if (!_adminArrearsCache) return;
  var res     = _adminArrearsCache;
  var modal   = document.getElementById('summaryDetailModal');
  var titleEl = document.getElementById('summaryDetailTitle');
  var ctrl    = document.getElementById('summaryDetailControls');
  if (!modal) return;
  if (titleEl) titleEl.textContent = 'Belum Bayar';
  _arrearsFilter_ = { year: '', q: '' };

  // Kumpulkan tahun yang tersedia
  var yearsSet = {};
  (res.details || []).forEach(function(it){ (it.periods || []).forEach(function(p){ yearsSet[p.year] = 1; }); });
  var years = Object.keys(yearsSet).map(Number).sort(function(a,b){ return a-b; });

  if (ctrl) {
    ctrl.classList.remove('hidden');
    ctrl.innerHTML =
      '<div class="relative mb-2">' +
        '<svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input id="arrearsSearch" oninput="_arrearsSetQ_(this.value)" placeholder="Cari nama atau blok..." ' +
        'class="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"/>' +
      '</div>' +
      '<div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">' +
        '<button data-yr="" onclick="_arrearsSetYear_(\'\')" class="arrears-yr px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap">Semua</button>' +
        years.map(function(y){ return '<button data-yr="'+y+'" onclick="_arrearsSetYear_(\''+y+'\')" class="arrears-yr px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap">'+y+'</button>'; }).join('') +
      '</div>';
  }
  _arrearsHighlightYear_();
  _renderArrearsList_();
  modal.classList.remove('hidden');
}

function _arrearsSetQ_(v){ _arrearsFilter_.q = String(v||'').toLowerCase().trim(); _renderArrearsList_(); }
function _arrearsSetYear_(y){ _arrearsFilter_.year = String(y); _arrearsHighlightYear_(); _renderArrearsList_(); }

function _arrearsHighlightYear_(){
  document.querySelectorAll('#summaryDetailControls .arrears-yr').forEach(function(b){
    var active = (b.getAttribute('data-yr') || '') === _arrearsFilter_.year;
    b.classList.toggle('bg-primary', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('bg-gray-100', !active);
    b.classList.toggle('text-gray-500', !active);
  });
}

function _renderArrearsList_(){
  var res    = _adminArrearsCache;
  var listEl = document.getElementById('summaryDetailList');
  var countEl= document.getElementById('summaryDetailCount');
  if (!res || !listEl) return;
  var fy = _arrearsFilter_.year, q = _arrearsFilter_.q;

  var rows = (res.details || []).map(function(it){
    var periods = (it.periods || []).filter(function(p){ return !fy || String(p.year) === fy; });
    if (!periods.length) return null;
    if (q) { if ((String(it.blok||'') + ' ' + String(it.nama||'')).toLowerCase().indexOf(q) === -1) return null; }
    return { it: it, periods: periods };
  }).filter(Boolean);

  var totalMonths = rows.reduce(function(s,r){ return s + r.periods.length; }, 0);
  if (countEl) countEl.textContent = rows.length + ' rumah · ' + totalMonths + ' bulan';

  listEl.innerHTML = rows.length
    ? rows.map(function(r){
        var it = r.it;
        var chips = r.periods.map(function(p){
          return '<span class="text-[10px] bg-white border border-gray-200 text-gray-500 py-1 rounded text-center truncate">' +
            _escHtml_(String(p.month).slice(0, 3)) + ' ' + p.year + '</span>';
        }).join('');
        var statusBadge = it.status ? '<span class="text-[10px] text-gray-400">' + _escHtml_(it.status) + '</span>' : '';
        return '<div class="bg-gray-50 rounded-xl px-4 py-3">' +
          '<div class="flex items-center justify-between gap-2 mb-2">' +
            '<div class="min-w-0">' +
              '<p class="text-sm font-semibold text-gray-900 truncate">' + _escHtml_(it.blok) + ' · ' + _escHtml_(it.nama || '-') + '</p>' +
              statusBadge +
            '</div>' +
            '<span class="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full flex-shrink-0">' + r.periods.length + ' bln</span>' +
          '</div>' +
          '<div class="grid grid-cols-4 gap-1">' + chips + '</div>' +
        '</div>';
      }).join('')
    : '<p class="text-sm text-gray-400 text-center py-6">Tidak ada data pada filter ini.</p>';
}

function _renderAdminSummary_(res) {
  var totalEl = document.getElementById('summaryTotalRumah');
  if (totalEl) totalEl.textContent = (res.totalRumah || 0) + ' rumah';

  var st = res.status || {};
  var total = res.totalRumah || 0;
  var cards = [
    { key:'dihuni',      label:'Dihuni',       count:st.dihuni||0,      cls:'sc-green', accent:'#2563eb', icon:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { key:'tidakDihuni', label:'Tidak Dihuni', count:st.tidakDihuni||0, cls:'sc-amber', accent:'#D97706', icon:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="9" y1="22" x2="9" y2="12"/><line x1="15" y1="22" x2="15" y2="12"/>' },
    { key:'bank',        label:'Milik Bank',   count:st.bank||0,        cls:'sc-blue',  accent:'#2563EB', icon:'<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' }
  ];
  var statusEl = document.getElementById('summaryStatusCards');
  if (statusEl) {
    statusEl.innerHTML = cards.map(function(c) {
      var pct = total ? Math.round(c.count / total * 100) : 0;
      return '<button onclick="openSummaryDetail(\'' + c.key + '\')" class="summary-stat-card ' + c.cls + ' w-full text-left">' +
        '<div class="absolute -right-5 -top-5 w-20 h-20 rounded-full" style="background:' + c.accent + ';opacity:0.08;"></div>' +
        '<div class="relative">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<div class="w-9 h-9 rounded-xl flex items-center justify-center" style="background:' + c.accent + ';box-shadow:0 4px 10px -2px ' + c.accent + '66;">' +
              '<svg class="w-4 h-4" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">' + c.icon + '</svg>' +
            '</div>' +
            '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background:' + c.accent + '1A;color:' + c.accent + ';">' + pct + '%</span>' +
          '</div>' +
          '<div class="flex items-baseline gap-1">' +
            '<p class="text-3xl font-black leading-none" style="color:' + c.accent + ';">' + c.count + '</p>' +
            '<span class="text-[11px] text-gray-400 font-medium hidden sm:inline">rumah</span>' +
          '</div>' +
          '<p class="text-xs font-semibold text-gray-600 mt-1 leading-tight">' + c.label + '</p>' +
          '<div class="mt-2.5 h-1.5 rounded-full overflow-hidden" style="background:' + c.accent + '1A;">' +
            '<div class="h-full rounded-full" style="width:' + pct + '%;background:' + c.accent + ';transition:width .5s cubic-bezier(0.16,1,0.3,1);"></div>' +
          '</div>' +
          '<div class="flex items-center gap-1 mt-2.5 text-[11px] font-semibold whitespace-nowrap" style="color:' + c.accent + ';">' +
            '<span>Lihat detail</span>' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
          '</div>' +
        '</div>' +
      '</button>';
    }).join('');
  }

  var years = res.yearTotals || [];
  var yearEl = document.getElementById('summaryYearList');
  if (yearEl) {
    if (!years.length) {
      yearEl.innerHTML = '<p class="text-xs text-gray-400 py-2">Belum ada data.</p>';
    } else {
      yearEl.innerHTML = years.map(function(y) {
        return '<div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center flex-shrink-0">' +
              '<span class="text-xs font-black text-gray-700">' + String(y.year).slice(2) + '</span>' +
            '</div>' +
            '<div><p class="text-sm font-bold text-gray-900">Tahun ' + y.year + '</p>' +
            '<p class="text-[11px] text-gray-400">' + (y.paidCount || 0) + ' pembayaran</p></div>' +
          '</div>' +
          '<p class="text-sm font-black text-primary">' + _fmtRp_(y.total) + '</p>' +
        '</div>';
      }).join('');
    }
  }
}

var _SUMMARY_LABELS_ = { dihuni:'Rumah Dihuni', tidakDihuni:'Rumah Tidak Dihuni', bank:'Milik Bank' };

function openSummaryDetail(key) {
  if (!_adminSummaryCache || !_adminSummaryCache.details) return;
  var list  = _adminSummaryCache.details[key] || [];
  var modal = document.getElementById('summaryDetailModal');
  var titleEl = document.getElementById('summaryDetailTitle');
  var countEl = document.getElementById('summaryDetailCount');
  var listEl  = document.getElementById('summaryDetailList');
  if (!modal) return;
  var ctrl = document.getElementById('summaryDetailControls');
  if (ctrl) { ctrl.classList.add('hidden'); ctrl.innerHTML = ''; }
  if (titleEl) titleEl.textContent = _SUMMARY_LABELS_[key] || 'Detail';
  if (countEl) countEl.textContent = list.length + ' rumah';
  if (listEl) {
    listEl.innerHTML = list.length
      ? list.map(function(it) {
          var initial = (it.blok || '?').charAt(0).toUpperCase();
          return '<div class="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">' +
            '<div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">' +
              '<span class="text-xs font-bold text-primary">' + _escHtml_(initial) + '</span>' +
            '</div>' +
            '<div class="min-w-0"><p class="text-sm font-semibold text-gray-900 truncate">' + _escHtml_(it.blok) + ' · ' + _escHtml_(it.nama || '-') + '</p></div>' +
          '</div>';
        }).join('')
      : '<p class="text-sm text-gray-400 text-center py-6">Tidak ada data.</p>';
  }
  modal.classList.remove('hidden');
}

function closeSummaryDetail() {
  var modal = document.getElementById('summaryDetailModal');
  if (modal) modal.classList.add('hidden');
}

var _kasIplCurrentFolder_ = '';   // '' = root
var _kasIplCurrentPath_   = [];   // breadcrumb [{id,name}]

function loadAdminKasIplPreview() {
  var el = document.getElementById('adminKasIplPreviewList');
  if (!el) return;
  gasGet_('getKasIPLContents', {})
    .then(function(res) {
      if (!res || !res.ok) { el.innerHTML = '<p class="text-[11px] text-gray-400 py-1">Gagal memuat.</p>'; return; }
      var nf = (res.folders || []).length;
      var nd = (res.files   || []).length;
      var parts = [];
      if (nf) parts.push(nf + ' folder');
      if (nd) parts.push(nd + ' file');
      el.innerHTML = '<p class="text-[11px] text-gray-400 py-1">' +
        (parts.length ? parts.join(' · ') + ' di folder utama' : 'Folder masih kosong') + '</p>';
    })
    .catch(function() {
      el.innerHTML = '<p class="text-[11px] text-gray-400 py-1">Gagal memuat.</p>';
    });
}

function openKasIplCRUD() {
  var modal = document.getElementById('kasIplCRUDModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  loadKasIplContents(_kasIplCurrentFolder_ || '');
}

function closeKasIplCRUD() {
  var modal = document.getElementById('kasIplCRUDModal');
  if (modal) modal.classList.add('hidden');
}

function loadKasIplContents(folderId) {
  var el = document.getElementById('kasIplCRUDList');
  if (el) el.innerHTML = '<div class="space-y-2 py-1">' + '<div class="skeleton rounded-2xl" style="height:62px"></div>'.repeat(5) + '</div>';
  gasGet_('getKasIPLContents', { folderId: folderId || '' })
    .then(function(res) {
      if (!res || !res.ok) {
        if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">' + _escHtml_((res && res.error) || 'Gagal memuat') + '</p>';
        return;
      }
      _kasIplCurrentFolder_ = res.folderId || '';
      _kasIplCurrentPath_   = res.path || [];
      renderKasIplBreadcrumb(res);
      renderKasIplBrowser(res);
    })
    .catch(function() {
      if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat. Coba lagi.</p>';
    });
}

function renderKasIplBreadcrumb(res) {
  var bc = document.getElementById('kasIplBreadcrumb');
  if (!bc) return;
  var path = res.path || [];
  var chevron = '<svg class="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
  bc.innerHTML = path.map(function(node, i) {
    var isLast = i === path.length - 1;
    var label  = i === 0 ? 'Laporan Kas IPL' : node.name;   // root pakai label ramah
    var cls    = isLast ? 'font-semibold text-gray-700' : 'text-primary';
    var crumb  = '<button onclick="loadKasIplContents(\'' + node.id + '\')" class="' + cls + ' truncate max-w-[140px] active:opacity-60 transition" ' + (isLast ? 'disabled' : '') + '>' + _escHtml_(label) + '</button>';
    return (i > 0 ? chevron : '') + crumb;
  }).join('');
}

function renderKasIplBrowser(res) {
  var el = document.getElementById('kasIplCRUDList');
  if (!el) return;
  var folders = res.folders || [];
  var files   = res.files   || [];

  if (!folders.length && !files.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Folder ini kosong.' +
      (res.isRoot ? '' : ' Tap Upload untuk menambah laporan.') + '</p>';
    return;
  }

  var html = '';

  // FOLDER dulu
  html += folders.map(function(fo) {
    return '<button onclick="loadKasIplContents(\'' + fo.id + '\')" class="w-full bg-gray-50 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 active:scale-[0.99] transition text-left">' +
      '<div class="flex items-center gap-3 min-w-0 flex-1">' +
        '<div class="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">' +
          '<svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' +
        '</div>' +
        '<div class="min-w-0 flex-1"><p class="text-sm font-semibold text-gray-900 truncate">' + _escHtml_(fo.name) + '</p>' +
        '<p class="text-[11px] text-gray-400">Folder</p></div>' +
      '</div>' +
      '<svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
    '</button>';
  }).join('');

  // FILE
  html += files.map(function(f) {
    var safeName = _escHtml_(f.name);
    var jsName = (f.name || '').replace(/'/g, "\\'");
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">' +
      '<a href="' + (f.url || '#') + '" target="_blank" rel="noopener" class="flex items-center gap-3 min-w-0 flex-1">' +
        '<div class="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">' +
          '<svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '</div>' +
        '<div class="min-w-0 flex-1">' +
          '<p class="text-sm font-semibold text-gray-900 truncate">' + safeName + '</p>' +
          '<p class="text-[11px] text-gray-400">' + _escHtml_(f.date || '') + '</p>' +
        '</div>' +
      '</a>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="renameKasIplFile(\'' + f.id + '\',\'' + jsName + '\')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition" title="Ganti nama">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteKasIplFileConfirm(\'' + f.id + '\',\'' + jsName + '\')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition" title="Hapus">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  el.innerHTML = html;
}

function triggerKasIplUpload() {
  var input = document.getElementById('kasIplFileInput');
  if (input) { input.value = ''; input.click(); }
}

function handleKasIplUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;

  if (file.size > 25 * 1024 * 1024) {
    showToast('Ukuran file maksimal 25 MB', 'error');
    return;
  }

  var prog  = document.getElementById('kasIplUploadProgress');
  var label = document.getElementById('kasIplUploadLabel');
  var btn   = document.getElementById('kasIplUploadBtn');
  if (prog)  prog.classList.remove('hidden');
  if (label) label.innerText = 'Mengupload "' + file.name + '"...';
  if (btn)   btn.disabled = true;

  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result.split(',')[1];
    gasPost_('adminUploadKasIPL', {
      base64: base64,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      folderId: _kasIplCurrentFolder_ || ''   // upload ke folder yang sedang dibuka
    })
      .then(function(res) {
        if (prog) prog.classList.add('hidden');
        if (btn)  btn.disabled = false;
        if (!res || !res.ok) { showToast((res && res.error) || 'Gagal upload', 'error'); return; }
        showToast('Laporan berhasil diupload', 'success');
        loadKasIplContents(_kasIplCurrentFolder_ || '');
        loadAdminKasIplPreview();
      })
      .catch(function() {
        if (prog) prog.classList.add('hidden');
        if (btn)  btn.disabled = false;
        showToast('Gagal upload', 'error');
      });
  };
  reader.onerror = function() {
    if (prog) prog.classList.add('hidden');
    if (btn)  btn.disabled = false;
    showToast('Gagal membaca file', 'error');
  };
  reader.readAsDataURL(file);
}

function renameKasIplFile(id, currentName) {
  var newName = window.prompt('Ganti nama laporan:', currentName || '');
  if (newName === null) return;
  newName = newName.trim();
  if (!newName || newName === currentName) return;

  showToast('Menyimpan nama baru...', 'success');
  gasPost_('adminRenameKasIPL', { fileId: id, newName: newName })
    .then(function(res) {
      if (!res || !res.ok) { showToast((res && res.error) || 'Gagal ganti nama', 'error'); return; }
      showToast('Nama laporan diperbarui', 'success');
      loadKasIplContents(_kasIplCurrentFolder_ || '');
    })
    .catch(function() { showToast('Gagal ganti nama', 'error'); });
}

function deleteKasIplFileConfirm(id, name) {
  showDeleteConfirm('Hapus laporan "' + (name || '') + '"? File dipindah ke Trash Drive.', function() {
    deleteKasIplFile(id);
  });
}

function deleteKasIplFile(id) {
  gasPost_('adminDeleteKasIPL', { fileId: id })
    .then(function(res) {
      if (!res || !res.ok) { showToast((res && res.error) || 'Gagal menghapus', 'error'); return; }
      closeDeleteConfirm();
      showToast('Laporan dihapus', 'success');
      loadKasIplContents(_kasIplCurrentFolder_ || '');
      loadAdminKasIplPreview();
    })
    .catch(function() { showToast('Gagal menghapus', 'error'); });
}

var _kasIPLData = {
  '2023': {
    type: 'gsheet',
    // preview via Google Sheets viewer — cukup "Anyone with link"
    url: 'https://docs.google.com/spreadsheets/d/1a3vKtlGe50pKEZvkoAxz3MHmmwe94ZvBBIG0_zNLyL0/preview?gid=1918973875',
    editUrl: 'https://docs.google.com/spreadsheets/d/1a3vKtlGe50pKEZvkoAxz3MHmmwe94ZvBBIG0_zNLyL0/edit?gid=1918973875'
  },
  '2024': {
    type: 'gsheet',
    url: 'https://docs.google.com/spreadsheets/d/194MxUmNtEAkuWmpCdxSn86HdPBiYCGfUvFRJdD6wu3I/preview?gid=1918973875',
    editUrl: 'https://docs.google.com/spreadsheets/d/194MxUmNtEAkuWmpCdxSn86HdPBiYCGfUvFRJdD6wu3I/edit?gid=1918973875'
  },
  '2025': {
    type: 'gsheet',
    url: 'https://docs.google.com/spreadsheets/d/1ogM59jO7CUoSuzFQYXzhLmX7kne0dKKk-HcbiV3KPEY/preview?gid=1029759642',
    editUrl: 'https://docs.google.com/spreadsheets/d/1ogM59jO7CUoSuzFQYXzhLmX7kne0dKKk-HcbiV3KPEY/edit?gid=1029759642'
  },
  '2026': {
    type: 'folder',
    url: 'https://drive.google.com/embeddedfolderview?id=1nN2YFGGQZx3lF6SbGlr_eq_LsaLS0BYU#list',
    fallback: 'https://drive.google.com/drive/folders/1nN2YFGGQZx3lF6SbGlr_eq_LsaLS0BYU'
  }
};

function openKasIPL(year) {
  var data = _kasIPLData[year];
  if (!data) return;

  var modal = document.getElementById('pedomanViewer');
  var frame = document.getElementById('pedomanViewerFrame');
  var title = document.getElementById('pedomanViewerTitle');
  if (!modal || !frame) return;

  if (title) title.innerText = 'Kas IPL ' + year;

  // Reset frame style dulu
  frame.style.background = '';
  frame.style.backgroundColor = '';

  // Hapus fallback banner lama jika ada
  var oldBanner = document.getElementById('kasIplFallbackBanner');
  if (oldBanner) oldBanner.remove();

  if (data.type === 'folder') {
    // Sembunyikan iframe, tampilkan folder browser (read-only)
    frame.style.display = 'none';
    modal.classList.remove('hidden');
    history.pushState({ pedomanViewer: true }, '');

    var frameParent = frame.parentElement;
    if (frameParent) frameParent.style.position = 'relative';
    if (title) title.innerText = 'Laporan Kas IPL';

    // Mulai dari folder root (folderId kosong = root)
    _loadPubKasFolder_(frameParent, data.folderId || '');
    return;
  }

  // gsheet 2023-2025 — langsung load preview, tampilkan loading overlay
  var frameParent = frame.parentElement;
  if (frameParent) frameParent.style.position = 'relative';

  // Loading overlay
  var loadingDiv = document.createElement('div');
  loadingDiv.id = 'kasIplFallbackBanner';
  loadingDiv.style.cssText = 'position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;pointer-events:none;';
  loadingDiv.innerHTML =
    '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/>' +
      '<path d="M12 2a10 10 0 0 1 10 10" stroke="#2563eb" stroke-width="3"/>' +
    '</svg>' +
    '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat laporan...</p>';

  if (frameParent) frameParent.appendChild(loadingDiv);

  frame.style.display = '';
  frame.src = data.url;
  modal.classList.remove('hidden');
  history.pushState({ pedomanViewer: true }, '');

  // Hapus loading saat iframe selesai load
  frame.onload = function() {
    var lb = document.getElementById('kasIplFallbackBanner');
    if (lb) lb.remove();
  };

  // Safety timeout 10 detik
  setTimeout(function() {
    var lb = document.getElementById('kasIplFallbackBanner');
    if (lb) lb.remove();
  }, 10000);
}

function _showKasIplFallback_(container, url, year) {
  // Tampilkan fallback UI dengan tombol buka di browser
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:#fff',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:16px',
    'padding:32px',
    'z-index:10',
    'font-family:sans-serif',
    'text-align:center'
  ].join(';');

  // Icon
  div.innerHTML =
    '<div style="width:56px;height:56px;background:#eff6ff;border-radius:16px;display:flex;align-items:center;justify-content:center;">' +
      '<svg width="28" height="28" fill="none" stroke="#2563eb" stroke-width="1.8" viewBox="0 0 24 24">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>' +
      '</svg>' +
    '</div>' +
    '<div>' +
      '<p style="font-size:15px;font-weight:700;color:#111827;margin:0 0 6px 0;">Kas IPL ' + year + '</p>' +
      '<p style="font-size:13px;color:#6b7280;margin:0;line-height:1.5;">Dokumen perlu dibuka di Google Sheets</p>' +
    '</div>' +
    '<a href="' + url.replace('/pubhtml?gid', '/edit?gid').replace('&single=true&widget=true&headers=false', '') + '" ' +
       'target="_blank" ' +
       'style="display:flex;align-items:center;gap:8px;' +
              'background:#2563eb;color:#fff;' +
              'padding:12px 24px;border-radius:14px;' +
              'font-size:14px;font-weight:600;' +
              'text-decoration:none;">' +
      '<svg width="16" height="16" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
        '<polyline points="15 3 21 3 21 9"/>' +
        '<line x1="10" y1="14" x2="21" y2="3"/>' +
      '</svg>' +
      'Buka di Google Sheets' +
    '</a>' +
    '<button onclick="closePedomanViewer()" ' +
            'style="font-size:13px;color:#9ca3af;background:none;border:none;cursor:pointer;">' +
      'Tutup' +
    '</button>';

  if (container) container.appendChild(div);
}

/* ── PUBLIC — Folder browser read-only (samakan dgn admin) ── */
var _pubKasFolder_ = '';

function _loadPubKasFolder_(container, folderId) {
  if (!container) {
    var fr = document.getElementById('pedomanViewerFrame');
    container = fr && fr.parentElement;
  }
  if (!container) return;

  var old = document.getElementById('kasIplFallbackBanner');
  if (old) old.remove();

  var ld = document.createElement('div');
  ld.id = 'kasIplFallbackBanner';
  ld.style.cssText = 'position:absolute;inset:0;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;';
  ld.innerHTML =
    '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#2563eb" stroke-width="3"/></svg>' +
    '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat...</p>';
  container.appendChild(ld);

  gasGet_('getKasIPLContents', { folderId: folderId || '' })
    .then(function(res) {
      var lb = document.getElementById('kasIplFallbackBanner');
      if (lb) lb.remove();
      if (!res || !res.ok) { _showKasIpl2026Empty_(container); return; }
      _pubKasFolder_ = res.folderId || '';
      var hasFolders = res.folders && res.folders.length;
      var hasFiles   = res.files   && res.files.length;
      if (!hasFolders && !hasFiles) { _showKasIpl2026Empty_(container); return; }
      _renderKasIplBrowser_(container, res);
    })
    .catch(function() {
      var lb = document.getElementById('kasIplFallbackBanner');
      if (lb) lb.remove();
      _showKasIpl2026Empty_(container);
    });
}

function _renderKasIplBrowser_(container, res) {
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = 'position:absolute;inset:0;background:#f9fafb;overflow-y:auto;z-index:10;-webkit-overflow-scrolling:touch;';

  var folders = res.folders || [];
  var files   = res.files   || [];
  var path    = res.path    || [];

  // Breadcrumb
  var bc = '';
  if (path.length) {
    bc = '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:0 0 12px 2px;font-size:12px;">';
    path.forEach(function(node, i) {
      var isLast = i === path.length - 1;
      var label  = i === 0 ? 'Laporan Kas IPL' : node.name;
      if (i > 0) bc += '<svg style="width:12px;height:12px;flex-shrink:0;color:#d1d5db;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
      if (isLast) {
        bc += '<span style="font-weight:700;color:#374151;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escHtml_(label) + '</span>';
      } else {
        bc += '<button onclick="_loadPubKasFolder_(null,\'' + node.id + '\')" style="background:none;border:none;padding:0;color:#2563eb;font-weight:600;cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escHtml_(label) + '</button>';
      }
    });
    bc += '</div>';
  }

  var html = '<div style="padding:16px 16px 32px;">' + bc +
    '<div style="display:flex;flex-direction:column;gap:10px;">';

  // FOLDER
  folders.forEach(function(fo) {
    html +=
      '<button onclick="_loadPubKasFolder_(null,\'' + fo.id + '\')" ' +
        'style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;cursor:pointer;background:#ffffff;border-radius:18px;padding:14px;border:1px solid #f3f4f6;box-shadow:0 1px 4px rgba(0,0,0,0.05);-webkit-tap-highlight-color:transparent;">' +
        '<div style="width:36px;height:36px;border-radius:10px;background:#FFFBEB;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="18" height="18" fill="none" stroke="#F59E0B" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' +
        '</div>' +
        '<div style="flex:1;min-width:0;"><p style="font-size:13px;font-weight:600;color:#111827;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _escHtml_(fo.name) + '</p><p style="font-size:11px;color:#9ca3af;margin:2px 0 0;font-weight:500;">Folder</p></div>' +
        '<div style="width:28px;height:28px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></div>' +
      '</button>';
  });

  // FILE
  var isPdf = function(m) { return m && m.toLowerCase().indexOf('pdf') > -1; };
  files.forEach(function(f) {
    var escapedName = (f.name || '').replace(/'/g, "\\'");
    var iconBg = isPdf(f.mimeType) ? '#FEF2F2' : '#EFF6FF';
    var iconSt = isPdf(f.mimeType) ? '#DC2626' : '#2563EB';
    html +=
      '<button onclick="_openKasFile_(\'' + f.id + '\', \'' + escapedName + '\')" ' +
        'style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;cursor:pointer;background:#ffffff;border-radius:18px;padding:14px;border:1px solid #f3f4f6;box-shadow:0 1px 4px rgba(0,0,0,0.05);-webkit-tap-highlight-color:transparent;">' +
        '<div style="width:36px;height:36px;border-radius:10px;background:' + iconBg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="18" height="18" fill="none" stroke="' + iconSt + '" stroke-width="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '</div>' +
        '<div style="flex:1;min-width:0;"><p style="font-size:13px;font-weight:600;color:#111827;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _escHtml_(f.name) + '</p><p style="font-size:11px;color:#9ca3af;margin:2px 0 0;font-weight:500;">' + _escHtml_(f.date || '') + '</p></div>' +
        '<div style="width:28px;height:28px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></div>' +
      '</button>';
  });

  html += '</div></div>';
  div.innerHTML = html;
  container.appendChild(div);
}

function _renderKasIpl2026List_(container, files) {
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = 'position:absolute;inset:0;background:#f9fafb;overflow-y:auto;z-index:10;-webkit-overflow-scrolling:touch;';

  var isPdf = function(mime) {
    return mime && mime.toLowerCase().includes('pdf');
  };

  var html =
    '<div style="padding:16px 16px 32px;">' +
      '<p style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 10px 2px;">' +
        files.length + ' Dokumen Tersedia' +
      '</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">';

  files.forEach(function(f) {
    var icon = isPdf(f.mimeType)
      ? '<div style="width:36px;height:36px;border-radius:10px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="18" height="18" fill="none" stroke="#DC2626" stroke-width="1.8" viewBox="0 0 24 24">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/>' +
          '</svg>' +
        '</div>'
      : '<div style="width:36px;height:36px;border-radius:10px;background:#EFF6FF;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="18" height="18" fill="none" stroke="#2563EB" stroke-width="1.8" viewBox="0 0 24 24">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/>' +
          '</svg>' +
        '</div>';

    // Convert Drive URL ke preview URL untuk iframe
    // https://drive.google.com/file/d/FILE_ID/view → https://drive.google.com/file/d/FILE_ID/preview
    var previewUrl = 'https://drive.google.com/file/d/' + f.id + '/preview';
    var escapedName = f.name.replace(/'/g, "\\'");

    html +=
      '<button onclick="_openKasFile_(\'' + f.id + '\', \'' + escapedName + '\')" ' +
         'style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;cursor:pointer;' +
                'background:#ffffff;border-radius:18px;' +
                'padding:14px 14px;border:1px solid #f3f4f6;' +
                'box-shadow:0 1px 4px rgba(0,0,0,0.05);-webkit-tap-highlight-color:transparent;">' +
        icon +
        '<div style="flex:1;min-width:0;">' +
          '<p style="font-size:13px;font-weight:600;color:#111827;margin:0 0 3px 0;' +
                    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            f.name +
          '</p>' +
          '<p style="font-size:11px;color:#9ca3af;margin:0;font-weight:500;">' + f.date + '</p>' +
        '</div>' +
        '<div style="width:28px;height:28px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M9 18l6-6-6-6"/>' +
          '</svg>' +
        '</div>' +
      '</button>';
  });

  html += '</div></div>';
  div.innerHTML = html;
  if (container) container.appendChild(div);
}

function _showKasIpl2026Empty_(container) {
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = 'position:absolute;inset:0;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;padding:32px;text-align:center;font-family:sans-serif;';
  div.innerHTML =
    '<div style="width:52px;height:52px;background:#f3f4f6;border-radius:16px;display:flex;align-items:center;justify-content:center;">' +
      '<svg width="24" height="24" fill="none" stroke="#9ca3af" stroke-width="1.8" viewBox="0 0 24 24">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<path d="M14 2v6h6"/>' +
      '</svg>' +
    '</div>' +
    '<p style="font-size:14px;font-weight:600;color:#374151;margin:0;">Belum ada laporan</p>' +
    '<p style="font-size:12px;color:#9ca3af;margin:0;">Dokumen akan ditambahkan oleh pengurus</p>' +
    '<button onclick="closePedomanViewer()" ' +
            'style="margin-top:8px;font-size:13px;color:#9ca3af;background:none;border:none;cursor:pointer;">' +
      'Tutup' +
    '</button>';
  if (container) container.appendChild(div);
}

function _openKasFile_(fileId, fileName) {
  var frame  = document.getElementById('pedomanViewerFrame');
  var title  = document.getElementById('pedomanViewerTitle');
  var modal  = document.getElementById('pedomanViewer');
  if (!frame || !modal) return;

  // Hapus banner list
  var banner = document.getElementById('kasIplFallbackBanner');
  if (banner) banner.remove();

  // Update title
  if (title) title.innerText = fileName;

  // Tombol Back + Download di header
  var titleBar = title && title.parentElement;
  if (titleBar) {
    // Hapus tombol lama
    var oldBack = document.getElementById('kasBackBtn');
    if (oldBack) oldBack.remove();
    var oldDl = document.getElementById('kasDownloadBtn');
    if (oldDl) oldDl.remove();

    // === BACK BUTTON ===
    var backBtn = document.createElement('button');
    backBtn.id = 'kasBackBtn';
    backBtn.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:13px;' +
                            'color:#2563eb;font-weight:600;background:none;border:none;' +
                            'cursor:pointer;padding:4px 8px 4px 0;flex-shrink:0;white-space:nowrap;';
    backBtn.innerHTML =
      '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M19 12H5M12 5l-7 7 7 7"/>' +
      '</svg>Kembali';
    backBtn.onclick = function() {
      // Hapus tombol header tambahan
      var bb = document.getElementById('kasBackBtn');
      if (bb) bb.remove();
      var dl = document.getElementById('kasDownloadBtn');
      if (dl) dl.remove();

      // Reset frame
      frame.src = 'about:blank';
      frame.style.display = 'none';
      if (title) title.innerText = 'Laporan Kas IPL';

      // Kembali ke folder yang terakhir dibuka (folder browser)
      var frameParent = frame.parentElement;
      if (frameParent) frameParent.style.position = 'relative';
      _loadPubKasFolder_(frameParent, _pubKasFolder_ || '');
    };

    // === DOWNLOAD BUTTON ===
    var dlBtn = document.createElement('a');
    dlBtn.id = 'kasDownloadBtn';
    dlBtn.href = 'https://drive.google.com/uc?export=download&id=' + fileId;
    dlBtn.target = '_blank';
    dlBtn.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;' +
                          'color:#fff;font-weight:600;background:#2563eb;border:none;' +
                          'cursor:pointer;padding:6px 12px;border-radius:10px;' +
                          'text-decoration:none;flex-shrink:0;margin-left:auto;margin-right:8px;';
    dlBtn.innerHTML =
      '<svg width="14" height="14" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/>' +
        '<line x1="12" y1="15" x2="12" y2="3"/>' +
      '</svg>Unduh';

    // Insert: [back] [title] [download] [×]
    titleBar.insertBefore(backBtn, title);
    var closeBtn = modal.querySelector('button');
    if (closeBtn) {
      titleBar.insertBefore(dlBtn, closeBtn);
    } else {
      titleBar.appendChild(dlBtn);
    }
  }

  // === LOADING OVERLAY ===
  var frameParent2 = frame.parentElement;
  if (frameParent2) frameParent2.style.position = 'relative';

  var ldOverlay = document.createElement('div');
  ldOverlay.id = 'kasIplFallbackBanner';
  ldOverlay.style.cssText = 'position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;pointer-events:none;';
  ldOverlay.innerHTML =
    '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/>' +
      '<path d="M12 2a10 10 0 0 1 10 10" stroke="#2563eb" stroke-width="3"/>' +
    '</svg>' +
    '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat dokumen...</p>';
  if (frameParent2) frameParent2.appendChild(ldOverlay);

  // === LOAD IFRAME ===
  frame.style.display = '';
  // Gunakan Google Docs Viewer sebagai wrapper — lebih stabil di mobile/PWA
  // Tidak trigger reload saat zoom karena Google Docs Viewer handle zoom sendiri
  var viewerUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';
  frame.src = viewerUrl;

  frame.onload = function() {
    var lo = document.getElementById('kasIplFallbackBanner');
    if (lo && lo.style.pointerEvents === 'none') lo.remove();
  };

  // Safety remove loading setelah 8 detik
  setTimeout(function() {
    var lo = document.getElementById('kasIplFallbackBanner');
    if (lo && lo.style.pointerEvents === 'none') lo.remove();
  }, 8000);
}

/* Sync hunian card display ke rate bulan yang dipilih
   Hanya update visual jika user BELUM manual override */
function _syncHunianCardToSelectedMonths_() {
  // Jika user sudah manual pilih hunian, jangan override
  var hasManualOverride = Object.keys(userOverrideRateByYear || {}).length > 0;
  if (hasManualOverride) return;
  if (!wargaRateByMonth) return;

  // Cari rate dari bulan pertama yang dipilih
  var dominantRate = 0;
  var years = Object.keys(selectedMonthsByYear || {}).sort();
  for (var yi = 0; yi < years.length; yi++) {
    var yr = years[yi];
    var yrInt = parseInt(yr, 10);
    var months = selectedMonthsByYear[yr] || [];
    var rMap = wargaRateByMonth[yrInt] || {};
    for (var mi = 0; mi < months.length; mi++) {
      var key = yrInt + '_' + months[mi];
      if (rMap[key] && rMap[key] > 0) {
        dominantRate = rMap[key];
        break;
      }
    }
    if (dominantRate) break;
  }

  if (!dominantRate) dominantRate = selectedRate;
  if (!dominantRate) return;

  // Update selectedRate + hunian card visual (tanpa trigger override)
  selectedRate = dominantRate;
  rate = selectedRate;
  document.querySelectorAll('.hunian-card').forEach(function(card) {
    card.classList.remove('active');
    if (Number(card.dataset.value) === selectedRate) {
      card.classList.add('active');
    }
  });
}

/* ========================================================
   LAPOR — Fitur Laporan Masalah
   ======================================================== */

var _laporData_    = [];           // data aktif sesuai tab
var _laporTab_     = 'mine';       // 'mine' | 'all'
var _laporEditing_ = null;         // row data for admin update
var _laporCache_   = { mine: null, all: null }; // cache per tab

/* Form chooser (Mudik / Renovasi) di Home */
function openFormChooser(){ var m=document.getElementById('formChooserModal'); if(m) m.classList.remove('hidden'); }
function closeFormChooser(){ var m=document.getElementById('formChooserModal'); if(m) m.classList.add('hidden'); }

/* ============================================================
   JUALO — lapak warga (mirip OLX/Tokopedia sederhana)
   ============================================================ */
var _JUALAN_KAT_ = ['Elektronik','Perabot','Fashion','Makanan','Kendaraan','Hobi','Jasa','Lainnya'];
var _jualanCache_ = null;
var _jualanFilterKat_ = '';
var _jualanFilterStatus_ = '';   // admin QC: '' | 'approved' | 'pending'
var _jualanFormFotos_ = [];   // [{ id, dataUrl }]
var _jualanUploading_ = 0;

function _jualanThumb_(id, w){ return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + (w||800); }
function _jualanRp_(n){ n = Number(n||0); return n>0 ? ('Rp ' + n.toLocaleString('id-ID')) : 'Nego'; }
function _jualanIsAdmin_(){ return currentUser && currentUser.role === 'admin'; }
function _jualanMyEmail_(){ return currentUser && currentUser.email ? currentUser.email.toLowerCase() : ''; }

function openJualanPage(){
  // Lihat-lihat lapak BEBAS tanpa login; login hanya dibutuhkan saat posting/komentar.
  switchPage('jualanPage');
  history.pushState({ jualan: true }, '');
  _renderJualanFilter_();
  loadJualan(false);
}

function loadJualan(force){
  var grid    = document.getElementById('jualanGrid');
  var loading = document.getElementById('jualanLoading');
  var empty   = document.getElementById('jualanEmptyState');
  if(!force && _jualanCache_){ _renderJualanGrid_(); return; }
  if(grid) grid.innerHTML = '';
  if(empty) empty.classList.add('hidden');
  if(loading){ loading.classList.remove('hidden'); loading.style.display='flex'; }
  gasGet_('getJualanList').then(function(res){
    _jualanCache_ = (res && res.data) ? res.data : [];
    if(loading){ loading.classList.add('hidden'); loading.style.display=''; }
    _renderJualanGrid_();
  }).catch(function(){
    if(loading){ loading.classList.add('hidden'); loading.style.display=''; }
    if(grid) grid.innerHTML = '<div class="text-center text-red-400 text-sm py-10">Gagal memuat. <button onclick="loadJualan(true)" class="text-rose-500 font-semibold underline">Coba lagi</button></div>';
  });
}

function _renderJualanFilter_(){
  var bar = document.getElementById('jualanFilterBar');
  if(!bar) return;
  var chip = function(val,label){
    var on = (_jualanFilterKat_ === val);
    return '<button onclick="_jualanSetFilter_(\''+val+'\')" class="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition '+(on?'bg-rose-500 text-white':'bg-gray-100 text-gray-500')+'">'+label+'</button>';
  };
  bar.innerHTML = chip('','Semua') + _JUALAN_KAT_.map(function(k){ return chip(k,k); }).join('');
}
function _jualanSetFilter_(val){ _jualanFilterKat_ = val; _renderJualanFilter_(); _renderJualanGrid_(); }

function _renderJualanGrid_(){
  var grid  = document.getElementById('jualanGrid');
  var empty = document.getElementById('jualanEmptyState');
  if(!grid) return;
  var all = _jualanCache_ || [];
  // Hanya tampilkan yg published; lapak terjual/diturunkan hanya tampak utk pemiliknya
  var myEmail = _jualanMyEmail_();
  all = all.filter(function(x){
    var st = x.status || 'published';
    return st === 'published' || (x.email && x.email.toLowerCase() === myEmail);
  });
  var data = _jualanFilterKat_ ? all.filter(function(x){ return x.kategori === _jualanFilterKat_; }) : all;
  if(!data.length){
    grid.innerHTML = '';
    if(empty) empty.classList.remove('hidden');
    return;
  }
  if(empty) empty.classList.add('hidden');
  var cards = data.map(function(d){ return _jualanCardHtml_(d); }).join('');
  grid.innerHTML = '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">'+cards+'</div>';
}

// Inisial untuk avatar penjual
function _jualanInitial_(name){ var s=String(name||'W').trim(); return (s[0]||'W').toUpperCase(); }

function _jualanCardHtml_(d){
  var cover = d.fotoIds && d.fotoIds.length
    ? '<img src="'+_jualanThumb_(d.fotoIds[0],400)+'" loading="lazy" class="absolute inset-0 w-full h-full object-cover" alt="'+_esc_(d.judul)+'"/>'
    : '<div class="absolute inset-0 flex items-center justify-center text-gray-300"><svg class="w-10 h-10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg></div>';
  var multi = (d.fotoIds && d.fotoIds.length > 1)
    ? '<span class="absolute top-1.5 right-1.5 flex items-center gap-0.5 text-[9px] font-bold text-white bg-black/45 backdrop-blur-sm px-1.5 py-0.5 rounded-md"><svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 21h12a2 2 0 0 0 2-2V9"/></svg>'+d.fotoIds.length+'</span>'
    : '';
  var katChip = '<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold text-gray-700 bg-white/85 backdrop-blur-sm px-1.5 py-0.5 rounded-md">'+_esc_(d.kategori||'Lainnya')+'</span>';
  // Overlay status (terjual / diturunkan) — hanya muncul utk lapak non-published milik sendiri
  var st = d.status || 'published';
  var statusOverlay = '';
  if(st === 'sold') statusOverlay = '<div class="absolute inset-0 bg-black/45 flex items-center justify-center"><span class="text-white font-black text-sm tracking-wide border-2 border-white px-3 py-1 rounded-lg -rotate-6">TERJUAL</span></div>';
  else if(st === 'takedown') statusOverlay = '<div class="absolute inset-0 bg-black/45 flex items-center justify-center"><span class="text-white font-bold text-[11px] text-center px-2">Diturunkan admin</span></div>';
  return '<div onclick="openJualanDetail(\''+d.id+'\')" class="group bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden active:scale-[0.98] transition-transform cursor-pointer">' +
    '<div class="relative w-full bg-gray-100" style="aspect-ratio:1/1;">'+cover+multi+katChip+statusOverlay+'</div>' +
    '<div class="p-2.5">' +
      '<p class="text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2" style="min-height:2.4em;">'+_esc_(d.judul)+'</p>' +
      '<p class="text-[15px] font-black text-rose-600 mt-1" style="font-variant-numeric:tabular-nums;">'+_jualanRp_(d.harga)+'</p>' +
      '<div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-50 min-w-0">' +
        '<span class="w-4 h-4 rounded-full bg-rose-100 text-rose-600 text-[8px] font-bold flex items-center justify-center flex-shrink-0">'+_jualanInitial_(d.nama)+'</span>' +
        '<span class="text-[10px] text-gray-400 truncate">'+_esc_(d.nama||'Warga')+'</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _esc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function openJualanDetail(id){
  var d = (_jualanCache_||[]).find(function(x){ return x.id === id; });
  if(!d) return;
  var photos  = document.getElementById('jualanDetailPhotos');
  var body    = document.getElementById('jualanDetailBody');
  var footer  = document.getElementById('jualanDetailFooter');
  var counter = document.getElementById('jualanDetailCounter');
  var dots    = document.getElementById('jualanDetailDots');
  var thumbs  = document.getElementById('jualanDetailThumbs');
  var n = (d.fotoIds && d.fotoIds.length) ? d.fotoIds.length : 0;
  if(n){
    photos.innerHTML = d.fotoIds.map(function(fid){
      return '<img src="'+_jualanThumb_(fid,1000)+'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%;" alt="Foto '+_esc_(d.judul)+'"/>';
    }).join('');
  } else {
    photos.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-300"><svg class="w-16 h-16" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg></div>';
  }
  // Counter (hanya bila >1 foto)
  if(counter){ counter.classList.toggle('hidden', n <= 1); counter.textContent = n>1 ? ('1 / '+n) : ''; }
  if(dots) dots.classList.add('hidden'); // diganti strip thumbnail
  // Strip thumbnail tiap foto (tap untuk pindah) — ala galeri produk
  if(thumbs){
    thumbs.classList.toggle('hidden', n <= 1);
    thumbs.innerHTML = n>1 ? d.fotoIds.map(function(fid,i){
      return '<button type="button" onclick="_jualanGoPhoto_('+i+')" data-idx="'+i+'" class="jualan-thumb flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden border-2 transition '+(i===0?'border-white shadow-md':'border-white/50 opacity-70')+'"><img src="'+_jualanThumb_(fid,200)+'" class="w-full h-full object-cover" alt="thumb '+(i+1)+'"/></button>';
    }).join('') : '';
  }
  if(n>1){
    photos.onscroll = function(){
      var idx = Math.round(photos.scrollLeft / photos.clientWidth);
      if(counter) counter.textContent = (idx+1)+' / '+n;
      _jualanHighlightThumb_(idx);
    };
  } else { photos.onscroll = null; }

  var waNum = String(d.kontak||'').replace(/[^0-9]/g,'').replace(/^0/, '62');
  var waMsg = encodeURIComponent('Halo, saya tertarik dengan "'+d.judul+'" yang Anda jual di PWP. Apakah masih tersedia?');
  var st = d.status || 'published';
  var statusBadge = st==='sold'
      ? '<span class="inline-block text-[11px] font-bold text-white bg-gray-800 px-2 py-0.5 rounded-md ml-1">TERJUAL</span>'
    : st==='takedown'
      ? '<span class="inline-block text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md ml-1">Diturunkan</span>'
      : '';
  var stok = (d.qty && d.qty > 1) ? '<span class="text-[12px] font-semibold text-gray-400 ml-2">Stok '+d.qty+'</span>' : '';
  // ── INFO PRODUK (frozen) ──
  var info = document.getElementById('jualanDetailInfo');
  if(info) info.innerHTML =
    '<div class="flex items-start justify-between gap-2">' +
      '<div class="min-w-0">' +
        '<span class="inline-block text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md">'+_esc_(d.kategori||'Lainnya')+'</span>'+statusBadge +
        '<h2 class="text-lg font-bold text-gray-900 leading-snug mt-1.5">'+_esc_(d.judul)+'</h2>' +
        '<p class="mt-0.5"><span class="text-2xl font-black text-rose-600" style="font-variant-numeric:tabular-nums;">'+_jualanRp_(d.harga)+'</span>'+stok+'</p>' +
      '</div>' +
      '<button onclick="_jualanShare_(\''+d.id+'\')" aria-label="Bagikan" class="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-90 transition"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg></button>' +
    '</div>' +
    '<div class="flex items-center gap-2.5 mt-2.5 pt-2.5 border-t border-gray-100">' +
      '<span class="w-8 h-8 rounded-full bg-rose-100 text-rose-600 text-sm font-bold flex items-center justify-center flex-shrink-0">'+_jualanInitial_(d.nama)+'</span>' +
      '<div class="min-w-0">' +
        '<p class="text-sm font-semibold text-gray-800 truncate">'+_esc_(d.nama||'Warga')+'</p>' +
        '<p class="text-[11px] text-gray-400">'+_esc_(d.timestamp||'')+'</p>' +
      '</div>' +
    '</div>';
  // ── BODY (scrollable): deskripsi ──
  body.innerHTML =
    (d.deskripsi? '<p class="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Deskripsi</p><p class="text-sm text-gray-600 leading-relaxed whitespace-pre-line">'+_esc_(d.deskripsi)+'</p>' : '<p class="text-sm text-gray-300 italic">Tanpa deskripsi.</p>');

  var isOwner = d.email && d.email.toLowerCase() === _jualanMyEmail_();
  var waBtn = waNum? '<a href="https://wa.me/'+waNum+'?text='+waMsg+'" target="_blank" rel="noopener" aria-label="Chat penjual via WhatsApp" class="flex-1 py-3.5 rounded-2xl bg-blue-500 text-white font-semibold text-sm text-center active:scale-95 transition flex items-center justify-center gap-2 shadow-md shadow-blue-500/20"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-1.061z"/></svg>Chat WhatsApp</a>' : '<span class="flex-1 text-center text-xs text-gray-400 py-3.5">Kontak tidak tersedia</span>';
  var ownerIcons = isOwner? '<button onclick="openJualanForm(\''+d.id+'\')" aria-label="Edit lapak" class="w-12 h-12 flex items-center justify-center rounded-2xl bg-gray-100 text-gray-600 active:scale-95"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
                '<button onclick="deleteJualanConfirm(\''+d.id+'\')" aria-label="Hapus lapak" class="w-12 h-12 flex items-center justify-center rounded-2xl bg-red-50 text-red-600 active:scale-95"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' : '';
  // Status sold/terjual diatur dari menu Edit (bukan di footer detail)
  footer.innerHTML = '<div class="flex gap-2">' + waBtn + ownerIcons + '</div>';
  _jualanDetailId_ = d.id;
  _loadJualanKomentar_(d.id);
  document.getElementById('jualanDetailModal').classList.remove('hidden');
  _jualanSetTab_('desc');   // default ke tab Deskripsi + setup collapse
}

// Pindah tab Deskripsi / Diskusi
var _jualanActiveTab_ = 'desc';
function _jualanSetTab_(tab){
  _jualanActiveTab_ = tab;
  var desc = document.getElementById('jualanDetailDescPane');
  var disk = document.getElementById('jualanDetailDiskPane');
  var tD = document.getElementById('jualanTabDesc');
  var tK = document.getElementById('jualanTabDisk');
  if(!desc || !disk) return;
  var onCls  = 'flex-1 py-2.5 text-sm font-semibold border-b-2 border-rose-500 text-rose-600 transition-all';
  var offCls = 'flex-1 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-400 transition-all';
  if(tab === 'disk'){
    desc.classList.add('hidden'); disk.classList.remove('hidden');
    if(tK) tK.className = onCls; if(tD) tD.className = offCls;
  } else {
    disk.classList.add('hidden'); desc.classList.remove('hidden');
    if(tD) tD.className = onCls; if(tK) tK.className = offCls;
  }
  var scroll = document.getElementById('jualanDetailScroll');
  if(scroll) scroll.scrollTop = 0;
  _jualanSetupCollapse_();   // reset foto ke penuh + recompute ruang scroll utk konten tab aktif
}

// Collapsing photo header — pakai CSS position:sticky (native, GPU, anti-kedip).
// Tinggi/top di-set SEKALI saat buka; scroll-nya native tanpa JS per-frame.
function _jualanSetupCollapse_(){
  var wrap   = document.getElementById('jualanDetailPhotoWrap');
  var frozen = document.getElementById('jualanDetailFrozen');
  var scroll = document.getElementById('jualanDetailScroll');
  var thumbs = document.getElementById('jualanDetailThumbs');
  if(!wrap || !frozen || !scroll) return;
  requestAnimationFrame(function(){
    var w = scroll.clientWidth || 360;
    var fullH  = Math.min(w, Math.round((window.innerHeight||720) * 0.46));
    var banner = Math.max(110, Math.round(w * 0.34));   // sisa banner saat collapse penuh
    if(banner > fullH - 40) banner = Math.round(fullH * 0.5);
    // Foto: sticky dgn top negatif → menyusut sampai tersisa "banner" px di atas
    wrap.style.height = fullH + 'px';
    wrap.style.top    = (banner - fullH) + 'px';
    // Info+tab: sticky tepat di bawah banner
    frozen.style.top  = banner + 'px';
    scroll.scrollTop  = 0;
    if(thumbs){ thumbs.style.opacity = '1'; thumbs.style.pointerEvents = ''; }
    var card = scroll.parentElement;   // kartu modal → di-ekspand saat collapse
    if(card) card.classList.remove('expanded');
    // Listener super-ringan: fade thumbnail (opacity, no reflow) + toggle ekspand sheet
    var thr = (fullH - banner) * 0.45;
    scroll.onscroll = function(){
      var stp = scroll.scrollTop;
      var collapsed = stp > thr;
      if(thumbs){
        thumbs.style.opacity = collapsed ? '0' : '1';
        thumbs.style.pointerEvents = collapsed ? 'none' : '';
      }
      // Sheet "naik" saat collapse, balik saat di-scroll ke atas lagi (hysteresis biar tak flicker)
      if(card){
        if(stp > thr) card.classList.add('expanded');
        else if(stp < thr - 80) card.classList.remove('expanded');
      }
    };
    // Spacer agar foto selalu bisa collapse penuh — hitung utk kondisi sheet EKSPAND
    // (saat ekspand viewport scroll lebih tinggi → butuh ruang scroll ekstra)
    var expandDelta = Math.round((window.innerHeight||720) * 0.08); // 96dvh - 88dvh
    var spacer = document.getElementById('jualanDetailSpacer');
    if(!spacer){ spacer = document.createElement('div'); spacer.id = 'jualanDetailSpacer'; scroll.appendChild(spacer); }
    spacer.style.height = '0px';
    requestAnimationFrame(function(){
      var effClientH = scroll.clientHeight + expandDelta;
      var deficit = (fullH - banner) - (scroll.scrollHeight - effClientH);
      spacer.style.height = (deficit > 0 ? deficit : 0) + 'px';
    });
  });
}
// Bagikan lapak (Web Share API → fallback salin teks)
function _jualanShare_(id){
  var d = (_jualanCache_||[]).find(function(x){ return x.id === id; });
  if(!d) return;
  var harga = (d.harga > 0) ? ('Rp ' + Number(d.harga).toLocaleString('id-ID')) : 'Nego';
  var text = '🛒 ' + d.judul + '\n' + harga + (d.kategori ? (' · ' + d.kategori) : '') +
             (d.deskripsi ? ('\n\n' + d.deskripsi) : '') +
             '\n\nLihat di Lapak — jual-beli antar warga.';
  var url = location.origin + location.pathname;
  if(navigator.share){
    navigator.share({ title: d.judul, text: text, url: url }).catch(function(){});
  } else if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text + '\n' + url).then(function(){ showToast('Info lapak disalin ke clipboard','success'); }).catch(function(){ showToast('Gagal menyalin','error'); });
  } else {
    showToast('Bagikan tidak didukung di perangkat ini','error');
  }
}

/* ---- Diskusi / Tanya-jawab (ala Tokopedia) ---- */
var _jualanDetailId_ = null;
function _loadJualanKomentar_(jualanId){
  var list = document.getElementById('jualanKomentarList');
  var cnt  = document.getElementById('jualanKomentarCount');
  var wrap = document.getElementById('jualanKomentarInputWrap');
  var input= document.getElementById('jualanKomentarInput');
  if(input) input.value = '';
  if(typeof _jualanCancelReply_==='function') _jualanCancelReply_();
  if(wrap) wrap.classList.toggle('hidden', !currentUser);  // hanya warga login bisa komentar
  // Tamu (belum login): tampilkan ajakan login (bisa tetap baca diskusi)
  var loginHint = document.getElementById('jualanKomentarLoginHint');
  if(!currentUser){
    if(!loginHint && wrap && wrap.parentNode){
      loginHint = document.createElement('button');
      loginHint.id = 'jualanKomentarLoginHint';
      loginHint.className = 'w-full mt-3 py-2.5 rounded-xl text-[13px] font-semibold text-rose-600 bg-rose-50 active:scale-95 transition';
      loginHint.textContent = 'Login untuk ikut diskusi';
      loginHint.onclick = function(){ openLoginRequiredModal('Login untuk bertanya / komentar di Lapak.'); };
      wrap.parentNode.insertBefore(loginHint, wrap.nextSibling);
    }
    if(loginHint) loginHint.classList.remove('hidden');
  } else if(loginHint){ loginHint.classList.add('hidden'); }
  if(list) list.innerHTML = '<div class="text-[11px] text-gray-300 py-2">Memuat diskusi…</div>';
  if(cnt) cnt.textContent = '';
  gasGet_('getJualanKomentar', { jualanId: jualanId }).then(function(res){
    if(_jualanDetailId_ !== jualanId) return; // user sudah pindah
    _renderJualanKomentar_((res && res.data) ? res.data : []);
  }).catch(function(){ if(list) list.innerHTML = '<div class="text-[11px] text-gray-300 py-2">Gagal memuat diskusi.</div>'; });
}
var _jualanReplyTo_ = null;   // { id, nama }
function _komentarBubble_(c, isReply){
  var myEmail = _jualanMyEmail_();
  var isAdmin = _jualanIsAdmin_();
  var canDel = isAdmin || (c.email && c.email.toLowerCase() === myEmail);
  var sellerBadge = c.isSeller ? '<span class="text-[8px] font-bold text-white bg-rose-500 px-1.5 py-px rounded">Penjual</span>' : '';
  var av = isReply ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]';
  return '<div class="flex gap-2.5">' +
    '<span class="'+av+' rounded-full bg-gray-100 text-gray-500 font-bold flex items-center justify-center flex-shrink-0">'+_jualanInitial_(c.nama)+'</span>' +
    '<div class="min-w-0 flex-1">' +
      '<div class="flex items-center gap-1.5 flex-wrap">' +
        '<span class="text-[12px] font-semibold text-gray-800">'+_esc_(c.nama||'Warga')+'</span>'+sellerBadge +
        '<span class="text-[10px] text-gray-300">'+_esc_(c.timestamp||'')+'</span>' +
      '</div>' +
      '<p class="text-[13px] text-gray-600 leading-snug whitespace-pre-line mt-0.5">'+_esc_(c.komentar)+'</p>' +
      '<div class="flex items-center gap-3 mt-1">' +
        (currentUser? '<button onclick="_jualanSetReply_(\''+(isReply? (c.parentId||c.id) : c.id)+'\',\''+_esc_(c.nama||'Warga').replace(/\\\'/g,"")+'\')" class="text-[10px] font-semibold text-gray-400 hover:text-rose-500">Balas</button>' : '') +
        (canDel? '<button onclick="deleteJualanKomentarConfirm(\''+c.id+'\')" class="text-[10px] text-gray-300 hover:text-red-500">Hapus</button>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}
function _renderJualanKomentar_(arr){
  var list = document.getElementById('jualanKomentarList');
  var cnt  = document.getElementById('jualanKomentarCount');
  if(!list) return;
  if(cnt) cnt.textContent = arr.length ? ('· '+arr.length) : '';
  if(!arr.length){
    list.innerHTML = '<div class="text-xs text-gray-400 py-2">Belum ada diskusi. Jadi yang pertama bertanya 👋</div>';
    return;
  }
  // Kelompokkan: komentar utama + balasan per parentId
  var tops = [], repliesBy = {};
  arr.forEach(function(c){
    if(c.parentId){ (repliesBy[c.parentId] = repliesBy[c.parentId] || []).push(c); }
    else { tops.push(c); }
  });
  list.innerHTML = tops.map(function(c){
    var replies = (repliesBy[c.id] || []).map(function(r){
      return '<div class="mt-2.5">' + _komentarBubble_(r, true) + '</div>';
    }).join('');
    return '<div>' + _komentarBubble_(c, false) +
      (replies? '<div class="ml-9 mt-1 pl-3 border-l-2 border-gray-100">'+replies+'</div>' : '') +
    '</div>';
  }).join('');
}
function _jualanSetReply_(id, nama){
  _jualanReplyTo_ = { id: id, nama: nama };
  var chip = document.getElementById('jualanReplyChip');
  var nm = document.getElementById('jualanReplyName');
  if(nm) nm.textContent = nama;
  if(chip){ chip.classList.remove('hidden'); chip.classList.add('flex'); }
  var input = document.getElementById('jualanKomentarInput');
  if(input) input.focus();
}
function _jualanCancelReply_(){
  _jualanReplyTo_ = null;
  var chip = document.getElementById('jualanReplyChip');
  if(chip){ chip.classList.add('hidden'); chip.classList.remove('flex'); }
}
function submitJualanKomentar(){
  if(!currentUser){ openLoginRequiredModal('Login untuk ikut diskusi.'); return; }
  var input = document.getElementById('jualanKomentarInput');
  var btn   = document.getElementById('jualanKomentarSendBtn');
  var text  = (input ? input.value : '').trim();
  if(!text){ return; }
  var jualanId = _jualanDetailId_;
  if(btn){ btn.disabled = true; btn.innerHTML = '<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>'; }
  var nama = (currentUser && currentUser.fullName) || (currentUser && currentUser.wargaData && currentUser.wargaData[0] && currentUser.wargaData[0].nama) || (currentUser ? currentUser.email : 'Warga');
  var parentId = (_jualanReplyTo_ && _jualanReplyTo_.id) ? _jualanReplyTo_.id : '';
  gasPost_('addJualanKomentar', { payload: { jualanId: jualanId, email: currentUser.email, nama: nama, komentar: text, parentId: parentId } }).then(function(res){
    if(btn){ btn.disabled = false; btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>'; }
    if(res && res.ok){ if(input) input.value = ''; _jualanCancelReply_(); _loadJualanKomentar_(jualanId); }
    else { showToast((res&&res.error)||'Gagal mengirim','error'); }
  }).catch(function(){
    if(btn){ btn.disabled = false; btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>'; }
    showToast('Gagal mengirim','error');
  });
}
function deleteJualanKomentarConfirm(id){
  var doDel = function(){
    gasPost_('deleteJualanKomentar', { id: id, email: currentUser?currentUser.email:'', isAdmin: _jualanIsAdmin_() }).then(function(res){
      if(typeof closeDeleteConfirm==='function') closeDeleteConfirm();
      if(res && res.ok){ _loadJualanKomentar_(_jualanDetailId_); }
      else { showToast((res&&res.error)||'Gagal menghapus','error'); }
    }).catch(function(){ if(typeof closeDeleteConfirm==='function') closeDeleteConfirm(); showToast('Gagal menghapus','error'); });
  };
  if(typeof showDeleteConfirm==='function'){ showDeleteConfirm('Hapus komentar ini?', doDel); }
  else if(confirm('Hapus komentar ini?')){ doDel(); }
}
function closeJualanDetail(){
  var photos = document.getElementById('jualanDetailPhotos');
  if(photos){ photos.onscroll = null; photos.scrollLeft = 0; }
  var scroll = document.getElementById('jualanDetailScroll');
  if(scroll){ scroll.onscroll = null; scroll.scrollTop = 0; }
  var wrap = document.getElementById('jualanDetailPhotoWrap');
  if(wrap){ wrap.style.height = ''; wrap.style.top = ''; }
  var frozen = document.getElementById('jualanDetailFrozen');
  if(frozen){ frozen.style.top = ''; }
  var spacer = document.getElementById('jualanDetailSpacer');
  if(spacer){ spacer.style.height = '0px'; }
  var card = document.querySelector('#jualanDetailModal > div');
  if(card) card.classList.remove('expanded');
  _jualanDetailId_ = null;
  document.getElementById('jualanDetailModal').classList.add('hidden');
}
// Tap thumbnail → geser carousel utama ke foto ke-i
function _jualanGoPhoto_(i){
  var photos = document.getElementById('jualanDetailPhotos');
  if(!photos) return;
  try { photos.scrollTo({ left: i * photos.clientWidth, behavior: 'smooth' }); }
  catch(e){ photos.scrollLeft = i * photos.clientWidth; }
  _jualanHighlightThumb_(i);
}
function _jualanHighlightThumb_(idx){
  var thumbs = document.getElementById('jualanDetailThumbs');
  if(!thumbs) return;
  Array.prototype.forEach.call(thumbs.children, function(el,i){
    el.className = 'jualan-thumb flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden border-2 transition ' + (i===idx ? 'border-white shadow-md' : 'border-white/50 opacity-70');
  });
}

function toggleJualanApprove(id, approve, btnEl){
  if(btnEl){
    btnEl.disabled = true;
    btnEl.dataset.orig = btnEl.innerHTML;
    btnEl.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Memproses…</span>';
  }
  gasPost_('adminApproveJualan', { id: id, approve: approve, adminEmail: currentUser?currentUser.email:'' }).then(function(res){
    if(res && res.ok){
      var d = (_jualanCache_||[]).find(function(x){ return x.id === id; });
      if(d){ d.approved = approve; d.approvedBy = approve ? (currentUser?currentUser.email:'') : ''; }
      showToast(approve?'Lapak ditandai sudah di-QC':'Approval dibatalkan','success');
      _renderJualanQC_();
    } else {
      if(btnEl){ btnEl.disabled=false; btnEl.innerHTML=btnEl.dataset.orig; }
      showToast('Gagal memperbarui','error');
    }
  }).catch(function(){
    if(btnEl){ btnEl.disabled=false; btnEl.innerHTML=btnEl.dataset.orig; }
    showToast('Gagal memperbarui','error');
  });
}

// Pemilik tandai terjual / tersedia lagi (sold → otomatis tidak tampil ke warga lain)
function setJualanSold(id, sold, btnEl){
  var status = sold ? 'sold' : 'published';
  if(btnEl){ btnEl.disabled=true; btnEl.dataset.orig=btnEl.innerHTML; btnEl.innerHTML='<span class="flex items-center justify-center gap-1.5"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Memproses…</span>'; }
  gasPost_('setJualanStatus', { id:id, status:status, email: currentUser?currentUser.email:'', isAdmin:_jualanIsAdmin_() }).then(function(res){
    if(res && res.ok){
      var d=(_jualanCache_||[]).find(function(x){return x.id===id;}); if(d) d.status=status;
      showToast(sold?'Lapak ditandai terjual':'Lapak dipasang lagi','success');
      _renderJualanGrid_();
      openJualanDetail(id); // refresh tampilan detail
    } else { if(btnEl){btnEl.disabled=false;btnEl.innerHTML=btnEl.dataset.orig;} showToast((res&&res.error)||'Gagal memperbarui','error'); }
  }).catch(function(){ if(btnEl){btnEl.disabled=false;btnEl.innerHTML=btnEl.dataset.orig;} showToast('Gagal memperbarui','error'); });
}

// Admin takedown / publish lagi
function toggleJualanTakedown(id, takedown, btnEl){
  var status = takedown ? 'takedown' : 'published';
  if(btnEl){ btnEl.disabled=true; btnEl.dataset.orig=btnEl.innerHTML; btnEl.innerHTML='<span class="flex items-center justify-center gap-1.5"><svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Memproses…</span>'; }
  gasPost_('setJualanStatus', { id:id, status:status, email: currentUser?currentUser.email:'', isAdmin:true }).then(function(res){
    if(res && res.ok){
      var d=(_jualanCache_||[]).find(function(x){return x.id===id;}); if(d) d.status=status;
      showToast(takedown?'Lapak diturunkan (tidak tampil ke warga)':'Lapak dipublish lagi','success');
      _renderJualanQC_();
    } else { if(btnEl){btnEl.disabled=false;btnEl.innerHTML=btnEl.dataset.orig;} showToast((res&&res.error)||'Gagal memperbarui','error'); }
  }).catch(function(){ if(btnEl){btnEl.disabled=false;btnEl.innerHTML=btnEl.dataset.orig;} showToast('Gagal memperbarui','error'); });
}

/* ---- Admin QC: moderasi lapak warga (di dalam menu Admin) ---- */
var _jualanQCLoaded_ = false;
function openJualanQC(force){
  var box = document.getElementById('jualanQCContent');
  if(!box) return;
  // Pakai cache → render instan tanpa loading
  if(!force && _jualanQCLoaded_ && _jualanCache_){ _renderJualanQC_(); return; }
  // Ada data lama → tampilkan dulu sambil refresh diam-diam (no skeleton flash)
  if(_jualanCache_ && _jualanCache_.length){ _renderJualanQC_(); }
  else { box.innerHTML = '<div class="flex flex-col gap-2 pt-1"><div class="skeleton rounded-2xl w-full" style="height:84px;"></div><div class="skeleton rounded-2xl w-full" style="height:84px;"></div></div>'; }
  gasGet_('getJualanList').then(function(res){
    _jualanCache_ = (res && res.data) ? res.data : [];
    _jualanQCLoaded_ = true;
    _renderJualanQC_();
  }).catch(function(){
    if(!(_jualanCache_ && _jualanCache_.length)) box.innerHTML = '<div class="text-center text-red-400 text-sm py-8">Gagal memuat. <button onclick="openJualanQC(true)" class="text-rose-500 font-semibold underline">Coba lagi</button></div>';
  });
}
function _jualanQCSetStatus_(val){ _jualanFilterStatus_ = val; _renderJualanQC_(); }
function _renderJualanQC_(){
  var box = document.getElementById('jualanQCContent');
  if(!box) return;
  var all = _jualanCache_ || [];
  var pendingCount = all.filter(function(x){ return !x.approved; }).length;
  var data = _jualanFilterStatus_
    ? all.filter(function(x){ return _jualanFilterStatus_ === 'approved' ? x.approved : !x.approved; })
    : all;

  var approvedCount = all.length - pendingCount;
  var tab = function(val,label){
    var on = (_jualanFilterStatus_ === val);
    return '<button onclick="_jualanQCSetStatus_(\''+val+'\')" class="flex-1 text-[12px] font-semibold py-1.5 rounded-lg transition '+(on?'bg-white text-gray-900 shadow-sm':'text-gray-400')+'">'+label+'</button>';
  };
  var filterBar = '<div class="flex gap-1 p-1 bg-gray-100 rounded-xl">' +
    tab('','Semua '+all.length) + tab('pending','Belum QC '+pendingCount) + tab('approved','Sudah QC '+approvedCount) +
  '</div>';

  var list = data.map(function(d){
    var thumb = (d.fotoIds && d.fotoIds.length)
      ? '<img src="'+_jualanThumb_(d.fotoIds[0],200)+'" class="w-12 h-12 rounded-xl object-cover bg-gray-100 flex-shrink-0" alt="foto"/>'
      : '<div class="w-12 h-12 rounded-xl bg-gray-100 flex-shrink-0 flex items-center justify-center text-gray-300"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg></div>';
    var st = d.status || 'published';
    var statusText = d.approved
      ? '<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Sudah QC</span>'
      : '<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Belum QC</span>';
    var stChip = st==='takedown'
        ? '<span class="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-px rounded">Diturunkan</span>'
      : st==='sold'
        ? '<span class="text-[9px] font-bold text-gray-600 bg-gray-100 px-1.5 py-px rounded">Terjual</span>'
        : '';
    var primaryBtn = d.approved
      ? '<button onclick="toggleJualanApprove(\''+d.id+'\',false,this)" class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-amber-600 bg-amber-50 active:scale-95 transition">Batalkan</button>'
      : '<button onclick="toggleJualanApprove(\''+d.id+'\',true,this)" class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-blue-500 active:scale-95 transition flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Approve</button>';
    var takedownBtn = (st==='takedown')
      ? '<button onclick="toggleJualanTakedown(\''+d.id+'\',false,this)" class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-blue-600 bg-blue-50 active:scale-95 transition">Publish</button>'
      : '<button onclick="toggleJualanTakedown(\''+d.id+'\',true,this)" class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-red-500 bg-red-50 active:scale-95 transition">Takedown</button>';
    return '<div class="bg-white rounded-2xl border border-gray-100 p-3'+(st!=='published'?' opacity-75':'')+'">' +
      '<div class="flex gap-3 items-center">' + thumb +
        '<div class="min-w-0 flex-1">' +
          '<p class="text-[14px] font-bold text-gray-900 truncate">'+_esc_(d.judul)+'</p>' +
          '<p class="text-[13px] font-black text-rose-600" style="font-variant-numeric:tabular-nums;">'+_jualanRp_(d.harga)+'</p>' +
          '<div class="flex items-center gap-2 mt-0.5 flex-wrap">'+statusText+stChip+'<span class="text-[10px] text-gray-300 truncate">'+_esc_(d.nama||'Warga')+'</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-gray-50">' +
        primaryBtn +
        '<button onclick="openJualanDetail(\''+d.id+'\')" class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-gray-500 bg-gray-100 active:scale-95">Lihat</button>' +
        takedownBtn +
        '<button onclick="deleteJualanConfirm(\''+d.id+'\')" aria-label="Hapus" class="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' +
      '</div>' +
    '</div>';
  }).join('') || '<div class="text-center text-gray-400 text-sm py-10">Tidak ada lapak pada filter ini.</div>';

  box.innerHTML =
    '<div class="space-y-3">' +
      '<div class="flex items-center justify-between px-0.5">' +
        '<div>' +
          '<p class="text-sm font-bold text-gray-900">Moderasi Lapak</p>' +
          '<p class="text-[11px] text-gray-400">Semua lapak langsung tayang · tandai setelah dicek</p>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          (pendingCount
            ? '<span class="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full whitespace-nowrap">'+pendingCount+' belum QC</span>'
            : '<span class="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full whitespace-nowrap">Semua beres ✓</span>') +
          '<button onclick="openJualanQC(true)" title="Muat ulang" class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 bg-gray-100 active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M5 19a9 9 0 0 0 14-5M19 5a9 9 0 0 0-14 5"/></svg></button>' +
        '</div>' +
      '</div>' +
      filterBar +
      '<div class="grid gap-2 xl:grid-cols-2">'+list+'</div>' +
    '</div>';
}

function deleteJualanConfirm(id){
  var d = (_jualanCache_||[]).find(function(x){ return x.id === id; });
  var label = d ? ('"'+d.judul+'"') : 'listing ini';
  var doDel = function(){
    gasPost_('deleteJualan', { id: id, email: currentUser?currentUser.email:'', isAdmin: _jualanIsAdmin_() }).then(function(res){
      if(typeof closeDeleteConfirm==='function') closeDeleteConfirm();
      if(res && res.ok){
        _jualanCache_ = (_jualanCache_||[]).filter(function(x){ return x.id !== id; });
        showToast('Listing dihapus','success'); closeJualanDetail();
        _renderJualanGrid_();
        if(document.querySelector('#adminPanels > [data-panel="jualanqc"]:not(.hidden)')) _renderJualanQC_();
      } else { showToast((res&&res.error)||'Gagal menghapus','error'); }
    }).catch(function(){ if(typeof closeDeleteConfirm==='function') closeDeleteConfirm(); showToast('Gagal menghapus','error'); });
  };
  if(typeof showDeleteConfirm==='function'){ showDeleteConfirm('Hapus '+label+'?', doDel); }
  else if(confirm('Hapus '+label+'?')){ doDel(); }
}

// ---- Form ----
function _jualanFillKategori_(selected){
  var el = document.getElementById('jualanFormKategori');
  if(!el) return;
  el.innerHTML = _JUALAN_KAT_.map(function(k){ return '<option value="'+k+'"'+(k===selected?' selected':'')+'>'+k+'</option>'; }).join('');
}
function openJualanForm(id){
  if(!currentUser){ openLoginRequiredModal('Login dulu untuk pasang atau kelola lapak jualan.'); return; }
  var d = id ? (_jualanCache_||[]).find(function(x){ return x.id === id; }) : null;
  _jualanFormFotos_ = [];
  document.getElementById('jualanFormId').value = d ? d.id : '';
  document.getElementById('jualanFormTitle').innerText = d ? 'Edit Lapak' : 'Jual Barang';
  document.getElementById('jualanFormJudul').value = d ? d.judul : '';
  _jualanFillKategori_(d ? d.kategori : 'Lainnya');
  _iplSetRupiah_('jualanFormHarga', d && d.harga ? d.harga : '');
  document.getElementById('jualanFormQty').value = (d && d.qty) ? d.qty : 1;
  document.getElementById('jualanFormDeskripsi').value = d ? d.deskripsi : '';
  // Prefill kontak dari data warga
  var hp = '';
  if(currentUser && currentUser.wargaData && currentUser.wargaData.length) hp = currentUser.wargaData[0].noHp || '';
  document.getElementById('jualanFormKontak').value = d ? d.kontak : hp;
  document.getElementById('jualanFormFotoStatus').innerText = '';
  if(d && d.fotoIds){ _jualanFormFotos_ = d.fotoIds.map(function(fid){ return { id: fid, dataUrl: _jualanThumb_(fid,400) }; }); }
  _jualanRenderFotoRow_();
  // Status lapak (mark as sold) — hanya saat EDIT lapak milik sendiri (atau admin)
  _jualanFormRenderStatus_(d);
  document.getElementById('jualanDetailModal').classList.add('hidden');
  document.getElementById('jualanFormSheet').classList.remove('hidden');
}
function _jualanFormRenderStatus_(d){
  var wrap = document.getElementById('jualanFormStatusWrap');
  var btn  = document.getElementById('jualanFormSoldBtn');
  var hint = document.getElementById('jualanFormSoldHint');
  if(!wrap || !btn) return;
  var isOwner = d && d.email && d.email.toLowerCase() === _jualanMyEmail_();
  if(!d || (!isOwner && !_jualanIsAdmin_())){ wrap.classList.add('hidden'); return; }
  var st = d.status || 'published';
  if(st === 'takedown'){
    wrap.classList.remove('hidden');
    btn.className = 'w-full mt-2 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 bg-amber-100 text-amber-800 cursor-default';
    btn.onclick = null;
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Diturunkan Admin';
    if(hint) hint.innerText = 'Lapak diturunkan admin & tidak tampil ke warga lain.';
    return;
  }
  wrap.classList.remove('hidden');
  btn.onclick = _jualanFormToggleSold_;
  if(st === 'sold'){
    btn.className = 'w-full mt-2 py-3.5 rounded-2xl text-sm font-bold text-white bg-blue-500 active:scale-95 transition flex items-center justify-center gap-2 shadow-md shadow-blue-500/25';
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>Pasang Lagi';
    if(hint) hint.innerText = 'Lapak sedang ditandai TERJUAL — tersembunyi dari warga lain.';
  } else {
    btn.className = 'w-full mt-2 py-3.5 rounded-2xl text-sm font-bold text-white bg-gray-900 active:scale-95 transition flex items-center justify-center gap-2 shadow-md shadow-gray-900/20';
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Tandai Sudah Terjual';
    if(hint) hint.innerText = 'Begitu ditandai terjual, lapak otomatis disembunyikan dari warga lain.';
  }
}
function _jualanFormToggleSold_(){
  var id = document.getElementById('jualanFormId').value;
  if(!id) return;
  var d = (_jualanCache_||[]).find(function(x){ return x.id === id; });
  var sold = !(d && d.status === 'sold');
  var btn = document.getElementById('jualanFormSoldBtn');
  if(btn){ btn.disabled = true; var orig = btn.innerHTML; btn.innerHTML = '<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Memproses…'; btn._orig = orig; }
  gasPost_('setJualanStatus', { id:id, status: sold?'sold':'published', email: currentUser?currentUser.email:'', isAdmin:_jualanIsAdmin_() }).then(function(res){
    if(btn) btn.disabled = false;
    if(res && res.ok){
      if(d) d.status = sold ? 'sold' : 'published';
      showToast(sold?'Lapak ditandai terjual':'Lapak dipasang lagi','success');
      _jualanFormRenderStatus_(d);
      _renderJualanGrid_();
    } else { if(btn) btn.innerHTML = btn._orig; showToast((res&&res.error)||'Gagal memperbarui','error'); }
  }).catch(function(){ if(btn){ btn.disabled=false; btn.innerHTML = btn._orig; } showToast('Gagal memperbarui','error'); });
}
function closeJualanForm(){ document.getElementById('jualanFormSheet').classList.add('hidden'); }

function _jualanRenderFotoRow_(){
  var row = document.getElementById('jualanFormFotoRow');
  if(!row) return;
  var MAX = 5;
  var html = '';
  for(var i=0;i<MAX;i++){
    var f = _jualanFormFotos_[i];
    if(f && f.uploading){
      // Slot sedang uploading → preview redup + spinner + progress bar berjalan
      html += '<div class="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-gray-200 bg-gray-100">' +
        (f.dataUrl ? '<img src="'+f.dataUrl+'" class="w-full h-full object-cover opacity-40" alt="Mengupload"/>' : '') +
        '<div class="absolute inset-0 flex items-center justify-center bg-black/25">' +
          '<svg class="w-5 h-5 text-white" style="animation:spin 0.8s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke-opacity="0.3"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>' +
        '</div>' +
        '<div class="absolute bottom-0 inset-x-0 h-1 bg-white/40 overflow-hidden"><div class="h-full w-1/3 bg-rose-500 jualan-bar"></div></div>' +
      '</div>';
    } else if(f){
      html += '<div class="relative flex-shrink-0">' +
        '<img src="'+f.dataUrl+'" class="w-16 h-16 rounded-xl object-cover bg-gray-100 border border-gray-200" alt="Foto '+(i+1)+'"/>' +
        (i===0? '<span class="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-white bg-rose-500 px-1 py-px rounded">Utama</span>' : '') +
        '<button onclick="_jualanRemoveFoto_('+i+')" aria-label="Hapus foto" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow active:scale-90"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
      '</div>';
    } else {
      var firstEmpty = (i === _jualanFormFotos_.length);
      html += '<button onclick="document.getElementById(\'jualanFormFotoFile\').click()" '+(firstEmpty?'':'disabled')+' class="flex-shrink-0 w-16 h-16 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition '+(firstEmpty?'border-rose-300 text-rose-400 active:scale-95':'border-gray-200 text-gray-300')+'">' +
        (firstEmpty? '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>' : '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>') +
        '<span class="text-[8px] mt-0.5">'+(i+1)+'</span>' +
      '</button>';
    }
  }
  row.innerHTML = html;
}
function _jualanRemoveFoto_(i){ _jualanFormFotos_.splice(i,1); _jualanRenderFotoRow_(); }

// Kompres gambar via canvas → JPEG, lalu upload ke Drive
function _jualanCompress_(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(e){
      var img = new Image();
      img.onload = function(){
        var MAX = 1000;
        var scale = Math.min(1, MAX / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = cv.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function _jualanUpdFotoStatus_(){
  var status = document.getElementById('jualanFormFotoStatus');
  if(!status) return;
  if(_jualanUploading_>0){
    status.innerHTML = '<span class="inline-flex items-center gap-1 text-rose-500"><svg class="w-3 h-3" style="animation:spin 0.8s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke-opacity="0.3"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>Mengupload '+_jualanUploading_+' foto…</span>';
  } else {
    status.textContent = '';
  }
}
function _jualanPickFotos_(input){
  var files = Array.prototype.slice.call(input.files || []);
  input.value = '';
  if(!files.length) return;
  var slots = 5 - _jualanFormFotos_.length;
  files = files.slice(0, slots);
  files.forEach(function(file){
    var tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    _jualanUploading_++;
    // Tampilkan slot "uploading" SEKARANG juga (sebelum kompres/upload selesai)
    _jualanFormFotos_.push({ tempId: tempId, dataUrl: '', uploading: true });
    _jualanRenderFotoRow_();
    _jualanUpdFotoStatus_();
    var _find = function(){ for(var k=0;k<_jualanFormFotos_.length;k++){ if(_jualanFormFotos_[k].tempId===tempId) return _jualanFormFotos_[k]; } return null; };
    var _drop = function(){ _jualanFormFotos_ = _jualanFormFotos_.filter(function(x){ return x.tempId !== tempId; }); };
    _jualanCompress_(file).then(function(dataUrl){
      var it = _find(); if(it){ it.dataUrl = dataUrl; _jualanRenderFotoRow_(); } // preview muncul, spinner tetap
      var base64 = dataUrl.split(',')[1];
      return gasPost_('uploadJualanFoto', { base64: base64, filename: (file.name||'foto.jpg'), mimeType: 'image/jpeg' }).then(function(res){
        var it2 = _find();
        if(res && res.ok && res.id){
          if(it2){ it2.id = res.id; it2.uploading = false; }   // selesai → jadi foto biasa
        } else {
          _drop(); showToast('Upload foto gagal','error');
        }
        _jualanRenderFotoRow_();
      });
    }).catch(function(){ _drop(); _jualanRenderFotoRow_(); showToast('Foto gagal diproses','error'); })
      .then(function(){ _jualanUploading_--; _jualanUpdFotoStatus_(); });
  });
}

function saveJualanForm(){
  var judul = document.getElementById('jualanFormJudul').value.trim();
  var kontak = document.getElementById('jualanFormKontak').value.trim();
  if(!judul){ showToast('Judul wajib diisi','error'); return; }
  if(!kontak){ showToast('Kontak WA wajib diisi','error'); return; }
  if(_jualanUploading_ > 0){ showToast('Tunggu foto selesai diupload','error'); return; }
  var btn = document.getElementById('jualanFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px"><svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Menyimpan...</span>';
  var nama = (currentUser && currentUser.fullName) || (currentUser && currentUser.wargaData && currentUser.wargaData[0] && currentUser.wargaData[0].nama) || (currentUser ? currentUser.email : 'Warga');
  var payload = {
    id        : document.getElementById('jualanFormId').value || null,
    email     : currentUser ? currentUser.email : '',
    nama      : nama,
    judul     : judul,
    kategori  : document.getElementById('jualanFormKategori').value,
    deskripsi : document.getElementById('jualanFormDeskripsi').value.trim(),
    kontak    : kontak,
    harga     : _iplNumVal_('jualanFormHarga'),
    qty       : Math.max(1, parseInt(document.getElementById('jualanFormQty').value,10) || 1),
    fotoIds   : _jualanFormFotos_.filter(function(f){ return f.id; }).map(function(f){ return f.id; }),
    isAdmin   : _jualanIsAdmin_()
  };
  gasPost_('submitJualan', { payload: payload }).then(function(res){
    btn.disabled = false; btn.innerText = 'Pasang Lapak';
    if(res && res.ok){
      closeJualanForm();
      showToast(payload.id?'Lapak diperbarui':'Lapak terpasang','success');
      loadJualan(true);
    } else { showToast((res&&res.error)||'Gagal menyimpan','error'); }
  }).catch(function(){ btn.disabled = false; btn.innerText = 'Pasang Lapak'; showToast('Gagal menyimpan','error'); });
}

function openLaporPage() {
  if (!currentUser) {
    openLoginRequiredModal('Silakan login untuk mengakses Lapor Masalah.');
    return;
  }
  setActiveNavById('navLapor');
  switchPage('laporPage');
  _renderLaporPage_();
}

function _renderLaporPage_() {
  var loginReq   = document.getElementById('laporLoginRequired');
  var emptyState = document.getElementById('laporEmptyState');
  var loading    = document.getElementById('laporLoading');
  var list       = document.getElementById('laporList');
  var tabAll     = document.getElementById('laporTabAll');
  var newBtn     = document.getElementById('laporNewBtn');

  // Show/hide admin tab
  var isAdmin = currentUser && currentUser.role === 'admin';
  if (tabAll) tabAll.classList.toggle('hidden', !isAdmin);

  if (loginReq) loginReq.classList.add('hidden');
  if (newBtn)   newBtn.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');

  var email      = currentUser.email;
  var cacheKey   = _laporTab_; // 'mine' | 'all'
  var adminParam = (isAdmin && _laporTab_ === 'all') ? 'true' : 'false';

  // Gunakan cache jika ada — tampil langsung tanpa loading
  if (_laporCache_[cacheKey] !== null) {
    if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
    _laporData_ = _laporCache_[cacheKey];
    if (_laporData_.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
    } else {
      _renderLaporList_(_laporData_);
    }
    // Refresh di background diam-diam
    gasGet_('getPengaduanList', { email: email, isAdmin: adminParam })
      .then(function(res) {
        if (!res.ok) return;
        _laporCache_[cacheKey] = res.data || [];
        // Update tampilan hanya jika tab masih sama
        if (_laporTab_ === cacheKey) {
          _laporData_ = _laporCache_[cacheKey];
          if (_laporData_.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (list) list.innerHTML = '';
          } else {
            if (emptyState) emptyState.classList.add('hidden');
            _renderLaporList_(_laporData_);
          }
        }
      }).catch(function() {});
    return;
  }

  // Belum ada cache — tampilkan loading
  if (loading)  { loading.classList.remove('hidden'); loading.style.display = 'flex'; }
  if (list)     list.innerHTML = '';

  gasGet_('getPengaduanList', { email: email, isAdmin: adminParam })
    .then(function(res) {
      if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
      if (!res.ok) { showToast('Gagal memuat laporan','error'); return; }
      _laporCache_[cacheKey] = res.data || [];
      _laporData_ = _laporCache_[cacheKey];
      if (_laporData_.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
      } else {
        _renderLaporList_(_laporData_);
      }
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
      showToast('Gagal memuat laporan','error');
    });
}

function _renderLaporList_(data) {
  var list = document.getElementById('laporList');
  if (!list) return;
  var isAdmin = currentUser && currentUser.role === 'admin';

  var statusConfig = {
    'Masuk'    : { cls: 'lapor-badge-masuk',    emoji: '🔴', label: 'Masuk' },
    'Diproses' : { cls: 'lapor-badge-diproses',  emoji: '🔵', label: 'Diproses' },
    'Selesai'  : { cls: 'lapor-badge-selesai',   emoji: '🟢', label: 'Selesai' },
    'Ditolak'  : { cls: 'lapor-badge-ditolak',   emoji: '⚫', label: 'Ditolak' }
  };

  list.innerHTML = data.map(function(item, idx) {
    var sc = statusConfig[item.status] || statusConfig['Masuk'];
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-2 cursor-pointer active:opacity-80 transition"'
      + ' onclick="_openLaporDetail_(' + idx + ')">'
      + '<div class="flex items-start justify-between gap-2">'
      + '<div class="flex-1 min-w-0">'
      + '<p class="text-sm font-bold text-gray-900 truncate">' + _esc_(item.judul) + '</p>'
      + (isAdmin && _laporTab_ === 'all' ? '<p class="text-xs text-gray-400 mt-0.5">' + _esc_(item.nama) + ' · ' + _esc_(item.unit) + '</p>' : '')
      + '</div>'
      + '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ' + sc.cls + '">' + sc.label + '</span>'
      + '</div>'
      + '<div class="flex items-center gap-2 flex-wrap">'
      + '<span class="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>'
      + '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>'
      + '</div>'
      + (item.catatan ? '<p class="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">' + _esc_(item.catatan) + '</p>' : '')
      + '</div>';
  }).join('');
}

function _esc_(str) {
  return (str || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function switchLaporTab(tab) {
  _laporTab_ = tab;
  var tabMine = document.getElementById('laporTabMine');
  var tabAll  = document.getElementById('laporTabAll');
  var active  = 'border-b-2 border-primary text-primary font-semibold';
  var inactive = 'border-b-2 border-transparent text-gray-400 font-medium';
  if (tabMine) tabMine.className = 'py-3 text-sm transition-all ' + (tab === 'mine' ? active : inactive);
  if (tabAll)  tabAll.className  = 'py-3 text-sm transition-all ' + (tab === 'all'  ? active : inactive);
  _renderLaporPage_();
}

// ── FORM ──────────────────────────────────────────────

function openLaporForm() {
  if (!currentUser) { openPageSaya(); return; }
  var sheet = document.getElementById('laporFormSheet');
  var card  = document.getElementById('laporFormCard');
  if (!sheet || !card) return;
  // Reset
  var sel = document.getElementById('laporKategori');
  var jdl = document.getElementById('laporJudul');
  var dsk = document.getElementById('laporDeskripsi');
  var err = document.getElementById('laporFormError');
  if (sel) sel.value = '';
  if (jdl) jdl.value = '';
  if (dsk) dsk.value = '';
  if (err) err.classList.add('hidden');

  document.body.classList.add('bottomsheet-open');
  sheet.classList.remove('hidden');
  card.style.transform = 'translateY(100%)';
  requestAnimationFrame(function() {
    card.style.transition = 'transform 0.3s ease';
    card.style.transform = 'translateY(0)';
  });
}

function closeLaporForm() {
  var sheet = document.getElementById('laporFormSheet');
  var card  = document.getElementById('laporFormCard');
  if (!sheet || !card) return;
  document.body.classList.remove('bottomsheet-open');
  card.style.transform = 'translateY(100%)';
  setTimeout(function() { sheet.classList.add('hidden'); }, 280);
}

function submitLaporForm() {
  var kategori  = (document.getElementById('laporKategori')?.value  || '').trim();
  var judul     = (document.getElementById('laporJudul')?.value     || '').trim();
  var deskripsi = (document.getElementById('laporDeskripsi')?.value || '').trim();
  var isAnon    = document.getElementById('laporAnonymous')?.checked || false;
  var err       = document.getElementById('laporFormError');
  var btn       = document.getElementById('laporSubmitBtn');
  var icon      = document.getElementById('laporSubmitIcon');
  var spinner   = document.getElementById('laporSubmitSpinner');
  var label     = document.getElementById('laporSubmitLabel');

  if (!kategori || !judul || !deskripsi) {
    if (err) { err.textContent = 'Kategori, judul, dan deskripsi wajib diisi.'; err.classList.remove('hidden'); }
    return;
  }
  if (err) err.classList.add('hidden');

  // Show spinner
  if (btn)     btn.disabled = true;
  if (icon)    icon.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');
  if (label)   label.textContent = 'Mengirim...';

  var payload = {
    email    : isAnon ? '' : currentUser.email,
    nama     : isAnon ? 'Anonim' : (currentUser.fullName || currentUser.name || currentUser.email),
    unit     : isAnon ? '' : (currentUser.blok || ''),
    kategori : kategori,
    judul    : judul,
    deskripsi: deskripsi
  };

  function _resetBtn_() {
    if (btn)     btn.disabled = false;
    if (icon)    icon.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
    if (label)   label.textContent = 'Kirim Laporan';
  }

  gasPost_('submitPengaduan', { payload: payload })
    .then(function(res) {
      _resetBtn_();
      if (!res.ok) {
        if (err) { err.textContent = res.error || 'Gagal mengirim laporan.'; err.classList.remove('hidden'); }
        return;
      }
      closeLaporForm();
      showToast('✅ Laporan terkirim! ID: ' + res.id, 'success');
      _laporCache_ = { mine: null, all: null }; // invalidate cache
      setTimeout(function() { _renderLaporPage_(); }, 400);
    })
    .catch(function() {
      _resetBtn_();
      if (err) { err.textContent = 'Gagal mengirim. Coba lagi.'; err.classList.remove('hidden'); }
    });
}

// ── DETAIL ────────────────────────────────────────────

function _openLaporDetail_(idx) {
  var item = _laporData_[idx];
  if (!item) return;
  var modal = document.getElementById('laporDetailModal');
  var body  = document.getElementById('laporDetailBody');
  if (!modal || !body) return;

  var isAdmin = currentUser && currentUser.role === 'admin';
  var statusOptions = ['Masuk','Diproses','Selesai','Ditolak'];

  body.innerHTML = ''
    + '<div class="flex items-center gap-2 flex-wrap">'
    + '<span class="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>'
    + '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">ID Laporan</p>'
    + '<p class="text-sm font-bold text-gray-900">' + _esc_(item.id) + '</p>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Judul</p>'
    + '<p class="text-sm font-semibold text-gray-900">' + _esc_(item.judul) + '</p>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Deskripsi</p>'
    + '<p class="text-sm text-gray-700 leading-relaxed">' + _esc_(item.deskripsi) + '</p>'
    + '</div>'
    + (isAdmin ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Pelapor</p>'
        + '<p class="text-sm text-gray-700">' + _esc_(item.nama) + ' · ' + _esc_(item.unit) + '</p></div>' : '')
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-1">Status</p>'
    + (isAdmin
      ? '<select id="laporDetailStatus" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none">'
          + statusOptions.map(function(s) {
              return '<option value="' + s + '"' + (item.status === s ? ' selected' : '') + '>' + s + '</option>';
            }).join('')
          + '</select>'
      : '<span class="text-sm font-semibold text-gray-900">' + _esc_(item.status) + '</span>')
    + '</div>'
    + (isAdmin
      ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-1">Catatan Admin</p>'
          + '<textarea id="laporDetailCatatan" rows="3" placeholder="Catatan untuk warga..."'
          + ' class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none resize-none">'
          + _esc_(item.catatan || '') + '</textarea></div>'
          + '<button onclick="_saveLaporStatus_(' + item.rowNumber + ')"'
          + ' class="w-full py-3 bg-primary text-white font-bold text-sm rounded-2xl active:opacity-80 transition">'
          + 'Simpan Update</button>'
      : (item.catatan ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Catatan Panitia</p>'
          + '<p class="text-sm text-gray-700 bg-blue-50 rounded-xl px-3 py-2">' + _esc_(item.catatan) + '</p></div>' : ''));

  modal.classList.remove('hidden');
}

function closeLaporDetail() {
  var modal = document.getElementById('laporDetailModal');
  if (modal) modal.classList.add('hidden');
}

function _saveLaporStatus_(rowNumber) {
  var status  = document.getElementById('laporDetailStatus')?.value  || '';
  var catatan = document.getElementById('laporDetailCatatan')?.value || '';
  if (!status) return;

  gasPost_('updatePengaduanStatus', {
    rowNumber  : rowNumber,
    status     : status,
    catatan    : catatan,
    adminEmail : currentUser.email
  })
  .then(function(res) {
    if (!res.ok) { showToast('Gagal update','error'); return; }
    closeLaporDetail();
    showToast('Status laporan diupdate!','success');
    _laporCache_ = { mine: null, all: null }; // invalidate cache
    _renderLaporPage_();
  })
  .catch(function() { showToast('Gagal update','error'); });
}

/* ========================================================
   SURAT PENGANTAR DIGITAL
   ======================================================== */

var _suratData_  = [];
var _suratTab_   = 'mine';       // 'mine' | 'all'
var _suratCache_ = { mine: null, all: null };

// ── FORM PENGAJUAN ───────────────────────────────────────

function openSuratPengantarModal() {
  if (!currentUser) { openPageSaya(); return; }
  var sheet = document.getElementById('suratFormSheet');
  var card  = document.getElementById('suratFormCard');
  if (!sheet || !card) return;

  var blok = (currentUser.blocks && currentUser.blocks[0]) || currentUser.blok || '';
  var nama = document.getElementById('suratNama');
  var blokEl = document.getElementById('suratBlok');
  if (nama) nama.value = currentUser.fullName || currentUser.email || '';
  if (blokEl) blokEl.value = blok;

  var jenis = document.getElementById('suratJenis');
  var lainnyaWrap = document.getElementById('suratJenisLainnyaWrap');
  var lainnya = document.getElementById('suratJenisLainnya');
  var keperluan = document.getElementById('suratKeperluan');
  var err = document.getElementById('suratFormError');
  if (jenis) jenis.value = '';
  if (lainnyaWrap) lainnyaWrap.classList.add('hidden');
  if (lainnya) lainnya.value = '';
  if (keperluan) keperluan.value = '';
  if (err) err.classList.add('hidden');

  document.body.classList.add('bottomsheet-open');
  sheet.classList.remove('hidden');
  card.style.transform = 'translateY(100%)';
  requestAnimationFrame(function() {
    card.style.transition = 'transform 0.3s ease';
    card.style.transform = 'translateY(0)';
  });
}

function closeSuratPengantarModal() {
  var sheet = document.getElementById('suratFormSheet');
  var card  = document.getElementById('suratFormCard');
  if (!sheet || !card) return;
  document.body.classList.remove('bottomsheet-open');
  card.style.transform = 'translateY(100%)';
  setTimeout(function() { sheet.classList.add('hidden'); }, 280);
}

function _onSuratJenisChange_() {
  var jenis = document.getElementById('suratJenis')?.value || '';
  var wrap  = document.getElementById('suratJenisLainnyaWrap');
  if (wrap) wrap.classList.toggle('hidden', jenis !== 'Lainnya');
}

function submitSuratPengantar() {
  var jenisSel = (document.getElementById('suratJenis')?.value || '').trim();
  var lainnya  = (document.getElementById('suratJenisLainnya')?.value || '').trim();
  var keperluan = (document.getElementById('suratKeperluan')?.value || '').trim();
  var err  = document.getElementById('suratFormError');
  var btn  = document.getElementById('suratSubmitBtn');
  var icon = document.getElementById('suratSubmitIcon');
  var spinner = document.getElementById('suratSubmitSpinner');
  var label = document.getElementById('suratSubmitLabel');

  var jenisSurat = jenisSel === 'Lainnya' ? lainnya : jenisSel;

  if (!jenisSel || (jenisSel === 'Lainnya' && !lainnya) || !keperluan) {
    if (err) { err.textContent = 'Jenis surat dan keperluan wajib diisi.'; err.classList.remove('hidden'); }
    return;
  }
  if (err) err.classList.add('hidden');

  if (btn)     btn.disabled = true;
  if (icon)    icon.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');
  if (label)   label.textContent = 'Mengirim...';

  var blok = (currentUser.blocks && currentUser.blocks[0]) || currentUser.blok || '';
  var payload = {
    email     : currentUser.email,
    nama      : currentUser.fullName || currentUser.email || '',
    blok      : blok,
    noHp      : currentUser.noHp || '',
    jenisSurat: jenisSurat,
    keperluan : keperluan
  };

  function _resetBtn_() {
    if (btn)     btn.disabled = false;
    if (icon)    icon.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
    if (label)   label.textContent = 'Ajukan';
  }

  gasPost_('submitSuratPengantar', { payload: payload })
    .then(function(res) {
      _resetBtn_();
      if (!res.ok) {
        if (err) { err.textContent = res.error || 'Gagal mengirim pengajuan.'; err.classList.remove('hidden'); }
        return;
      }
      closeSuratPengantarModal();
      showToast('✅ Pengajuan terkirim! ID: ' + res.id, 'success');
      _suratCache_ = { mine: null, all: null };
      setTimeout(function() { openSuratPengantarPage(); }, 400);
    })
    .catch(function() {
      _resetBtn_();
      if (err) { err.textContent = 'Gagal mengirim. Coba lagi.'; err.classList.remove('hidden'); }
    });
}

// ── RIWAYAT (LIST) ────────────────────────────────────────

function openSuratPengantarPage() {
  if (!currentUser) { openPageSaya(); return; }
  switchPage('suratPengantarPage');
  _renderSuratPengantarPage_();
}

function _renderSuratPengantarPage_() {
  var emptyState = document.getElementById('suratEmptyState');
  var loading    = document.getElementById('suratLoading');
  var list       = document.getElementById('suratList');
  var tabAll     = document.getElementById('suratTabAll');

  var isAdmin = currentUser && currentUser.role === 'admin';
  if (tabAll) tabAll.classList.toggle('hidden', !isAdmin);
  var _role = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : '';
  var canOpenSettings = (_role === 'admin' || _role === 'pengurus' || _role === 'bendahara');
  var orgBtn = document.getElementById('suratOrgSettingsBtn');
  if (orgBtn) orgBtn.classList.toggle('hidden', !canOpenSettings);

  if (emptyState) emptyState.classList.add('hidden');

  var email      = currentUser.email;
  var cacheKey   = _suratTab_;
  var adminParam = (isAdmin && _suratTab_ === 'all') ? 'true' : 'false';

  if (_suratCache_[cacheKey] !== null) {
    if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
    _suratData_ = _suratCache_[cacheKey];
    if (_suratData_.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (list) list.innerHTML = '';
    } else {
      _renderSuratPengantarList_(_suratData_);
    }
    gasGet_('getSuratPengantarList', { email: email, isAdmin: adminParam })
      .then(function(res) {
        if (!res.ok) return;
        _suratCache_[cacheKey] = res.data || [];
        if (_suratTab_ === cacheKey) {
          _suratData_ = _suratCache_[cacheKey];
          if (_suratData_.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (list) list.innerHTML = '';
          } else {
            if (emptyState) emptyState.classList.add('hidden');
            _renderSuratPengantarList_(_suratData_);
          }
        }
      }).catch(function() {});
    return;
  }

  if (loading) { loading.classList.remove('hidden'); loading.style.display = 'flex'; }
  if (list)    list.innerHTML = '';

  gasGet_('getSuratPengantarList', { email: email, isAdmin: adminParam })
    .then(function(res) {
      if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
      if (!res.ok) { showToast('Gagal memuat data','error'); return; }
      _suratCache_[cacheKey] = res.data || [];
      _suratData_ = _suratCache_[cacheKey];
      if (_suratData_.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
      } else {
        _renderSuratPengantarList_(_suratData_);
      }
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
      showToast('Gagal memuat data','error');
    });
}

function _renderSuratPengantarList_(data) {
  var list = document.getElementById('suratList');
  if (!list) return;
  var isAdmin = currentUser && currentUser.role === 'admin';

  var statusConfig = {
    'Diajukan'  : { cls: 'surat-badge-diajukan',  label: 'Diajukan' },
    'Diproses'  : { cls: 'surat-badge-diproses',  label: 'Diproses' },
    'Disetujui' : { cls: 'surat-badge-disetujui', label: 'Disetujui' },
    'Ditolak'   : { cls: 'surat-badge-ditolak',   label: 'Ditolak' }
  };

  list.innerHTML = data.map(function(item, idx) {
    var sc = statusConfig[item.status] || statusConfig['Diajukan'];
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-2 cursor-pointer active:opacity-80 transition"'
      + ' onclick="_openSuratDetail_(' + idx + ')">'
      + '<div class="flex items-start justify-between gap-2">'
      + '<div class="flex-1 min-w-0">'
      + '<p class="text-sm font-bold text-gray-900 truncate">' + _esc_(item.jenisSurat) + '</p>'
      + (isAdmin && _suratTab_ === 'all' ? '<p class="text-xs text-gray-400 mt-0.5">' + _esc_(item.nama) + ' · Blok ' + _esc_(item.blok) + '</p>' : '')
      + '</div>'
      + '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ' + sc.cls + '">' + sc.label + '</span>'
      + '</div>'
      + '<p class="text-xs text-gray-500 truncate">' + _esc_(item.keperluan) + '</p>'
      + '<div class="flex items-center gap-2 flex-wrap">'
      + '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

function switchSuratTab(tab) {
  _suratTab_ = tab;
  var tabMine = document.getElementById('suratTabMine');
  var tabAll  = document.getElementById('suratTabAll');
  var active  = 'border-b-2 border-primary text-primary font-semibold';
  var inactive = 'border-b-2 border-transparent text-gray-400 font-medium';
  if (tabMine) tabMine.className = 'py-3 text-sm transition-all ' + (tab === 'mine' ? active : inactive);
  if (tabAll)  tabAll.className  = 'py-3 text-sm transition-all ' + (tab === 'all'  ? active : inactive);
  _renderSuratPengantarPage_();
}

var _orgKetuaSign_ = '';

function _orgPickSign_(input) {
  var file = input.files && input.files[0]; if (!file) return;
  var maxW = 280;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var scale = Math.min(1, maxW / img.width);
      var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      var dataUrl = cv.toDataURL('image/png');
      _orgKetuaSign_ = dataUrl;
      var prev = document.getElementById('orgKetuaSignPrev');
      prev.src = dataUrl; prev.classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function _orgRole_() { return (currentUser && currentUser.role) ? String(currentUser.role).toLowerCase() : ''; }
function _orgToggle_(id, show) { var el = document.getElementById(id); if (el) el.classList.toggle('hidden', !show); }

function openOrgSettings() {
  document.getElementById('orgSettingsModal').classList.remove('hidden');
  _orgKetuaSign_ = '';
  var prev = document.getElementById('orgKetuaSignPrev');
  prev.src = ''; prev.classList.add('hidden');

  // Role gating: pengurus→identitas+operasional, bendahara→keuangan, admin→semua
  var role = _orgRole_();
  var canSet = role === 'admin' || role === 'pengurus';
  var canFin = role === 'admin' || role === 'bendahara';
  _orgToggle_('orgGroupIdentitas', canSet);
  _orgToggle_('orgGroupOps', canSet);
  _orgToggle_('orgGroupFinance', canFin);

  gasGet_('getOrgSettings').then(function(res) {
    var s = (res && res.settings) ? res.settings : {};
    document.getElementById('orgKabupaten').value = s.kabupaten || '';
    document.getElementById('orgKecamatan').value = s.kecamatan || '';
    document.getElementById('orgDesa').value = s.desa || '';
    document.getElementById('orgRt').value = s.rt || '';
    document.getElementById('orgRw').value = s.rw || '';
    document.getElementById('orgNamaPerumahan').value = s.namaPerumahan || '';
    document.getElementById('orgAlamatLengkap').value = s.alamatLengkap || '';
    document.getElementById('orgKetuaNama').value = s.ketuaNama || '';
    // Keuangan
    document.getElementById('orgBankNama').value = s.bankNama || '';
    document.getElementById('orgNoRek').value = s.noRek || '';
    document.getElementById('orgRekeningAtasNama').value = s.rekeningAtasNama || '';
    document.getElementById('orgTarif1Label').value = s.tarif1Label || '';
    document.getElementById('orgTarif1Nominal').value = s.tarif1Nominal || '';
    document.getElementById('orgTarif2Label').value = s.tarif2Label || '';
    document.getElementById('orgTarif2Nominal').value = s.tarif2Nominal || '';
    document.getElementById('orgTarif3Label').value = s.tarif3Label || '';
    document.getElementById('orgTarif3Nominal').value = s.tarif3Nominal || '';
    // Operasional
    document.getElementById('orgJualanFolderId').value = s.jualanFolderId || '';
    if (s.ketuaSign) {
      _orgKetuaSign_ = s.ketuaSign;
      prev.src = s.ketuaSign; prev.classList.remove('hidden');
    }
  }).catch(function() {});
}

function closeOrgSettings() {
  document.getElementById('orgSettingsModal').classList.add('hidden');
}

function saveOrgSettings() {
  var btn = document.getElementById('orgSaveBtn');
  btn.disabled = true;
  btn.innerText = 'Menyimpan...';
  var role = _orgRole_();
  var canSet = role === 'admin' || role === 'pengurus';
  var canFin = role === 'admin' || role === 'bendahara';
  var payload = {};
  if (canSet) {
    payload.kabupaten = document.getElementById('orgKabupaten').value.trim();
    payload.kecamatan = document.getElementById('orgKecamatan').value.trim();
    payload.desa = document.getElementById('orgDesa').value.trim();
    payload.rt = document.getElementById('orgRt').value.trim();
    payload.rw = document.getElementById('orgRw').value.trim();
    payload.namaPerumahan = document.getElementById('orgNamaPerumahan').value.trim();
    payload.alamatLengkap = document.getElementById('orgAlamatLengkap').value.trim();
    payload.ketuaNama = document.getElementById('orgKetuaNama').value.trim();
    payload.ketuaSign = _orgKetuaSign_ || '';
    payload.jualanFolderId = document.getElementById('orgJualanFolderId').value.trim();
  }
  if (canFin) {
    payload.bankNama = document.getElementById('orgBankNama').value.trim();
    payload.noRek = document.getElementById('orgNoRek').value.trim();
    payload.rekeningAtasNama = document.getElementById('orgRekeningAtasNama').value.trim();
    payload.tarif1Label = document.getElementById('orgTarif1Label').value.trim();
    payload.tarif1Nominal = document.getElementById('orgTarif1Nominal').value.trim();
    payload.tarif2Label = document.getElementById('orgTarif2Label').value.trim();
    payload.tarif2Nominal = document.getElementById('orgTarif2Nominal').value.trim();
    payload.tarif3Label = document.getElementById('orgTarif3Label').value.trim();
    payload.tarif3Nominal = document.getElementById('orgTarif3Nominal').value.trim();
  }
  gasPost_('adminSetOrgSettings', { payload: payload, adminEmail: currentUser.email }).then(function(res) {
    btn.disabled = false;
    btn.innerText = 'Simpan';
    if (res && res.ok) {
      closeOrgSettings();
      showToast('Pengaturan tersimpan', 'success');
      if (typeof loadPerumahanName === 'function') loadPerumahanName(); // re-sync semua UI dinamis dari sheet
    } else {
      showToast((res && res.error) || 'Gagal menyimpan', 'error');
    }
  }).catch(function() {
    btn.disabled = false;
    btn.innerText = 'Simpan';
    showToast('Gagal menyimpan', 'error');
  });
}

// ── DETAIL & APPROVAL ─────────────────────────────────────

function _openSuratDetail_(idx) {
  var item = _suratData_[idx];
  if (!item) return;
  var modal = document.getElementById('suratDetailModal');
  var body  = document.getElementById('suratDetailBody');
  if (!modal || !body) return;

  var isAdmin = currentUser && currentUser.role === 'admin';
  var statusOptions = ['Diajukan','Diproses','Disetujui','Ditolak'];
  var statusConfig = {
    'Diajukan'  : { cls: 'surat-badge-diajukan',  label: 'Diajukan' },
    'Diproses'  : { cls: 'surat-badge-diproses',  label: 'Diproses' },
    'Disetujui' : { cls: 'surat-badge-disetujui', label: 'Disetujui' },
    'Ditolak'   : { cls: 'surat-badge-ditolak',   label: 'Ditolak' }
  };
  var sc = statusConfig[item.status] || statusConfig['Diajukan'];

  body.innerHTML = ''
    // Header: ID + tanggal + status badge
    + '<div class="flex items-start justify-between gap-2">'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">ID Pengajuan</p>'
    + '<p class="text-sm font-bold text-gray-900">' + _esc_(item.id) + '</p>'
    + '<p class="text-[11px] text-gray-400 mt-0.5">' + _esc_(item.timestamp) + '</p>'
    + '</div>'
    + '<span class="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ' + sc.cls + '">' + sc.label + '</span>'
    + '</div>'

    // Card: info surat
    + '<div class="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-2">'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Jenis Surat</p>'
    + '<p class="text-sm font-semibold text-gray-900">' + _esc_(item.jenisSurat) + '</p>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Keperluan</p>'
    + '<p class="text-sm text-gray-700 leading-relaxed">' + _esc_(item.keperluan) + '</p>'
    + '</div>'
    + (isAdmin ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Pemohon</p>'
        + '<p class="text-sm text-gray-700">' + _esc_(item.nama) + ' · Blok ' + _esc_(item.blok) + '</p></div>' : '')
    + '</div>'

    // Info untuk pemohon: catatan panitia + unduh PDF (tampil untuk semua, termasuk admin pemohon sendiri)
    + ((item.catatan ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Catatan Panitia</p>'
        + '<p class="text-sm text-gray-700 bg-blue-50 rounded-xl px-3 py-2">' + _esc_(item.catatan) + '</p></div>' : '')
      + (item.status === 'Disetujui' && item.pdfUrl
        ? '<a href="' + _esc_(item.pdfUrl) + '" target="_blank" class="w-full py-3 bg-primary text-white font-bold text-sm rounded-2xl active:opacity-80 transition flex items-center justify-center gap-2">'
          + '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>'
          + 'Unduh Surat (sudah ditandatangani)</a>'
        : (item.status === 'Disetujui'
          ? '<p class="text-[11px] text-gray-400 text-center">PDF belum tersedia, hubungi pengurus.</p>'
          : '')))

    // Card admin: update status
    + (isAdmin
      ? '<div class="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-2">'
          + '<p class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Update Status</p>'
          + '<select id="suratDetailStatus" class="app-input">'
            + statusOptions.map(function(s) {
                return '<option value="' + s + '"' + (item.status === s ? ' selected' : '') + '>' + s + '</option>';
              }).join('')
            + '</select>'
          + '<textarea id="suratDetailCatatan" rows="3" autocomplete="off" autocorrect="off" name="suratDetailCatatan" placeholder="Catatan untuk warga..." class="app-input resize-none">'
          + _esc_(item.catatan || '') + '</textarea>'
          + '</div>'
          + '<button id="suratDetailSaveBtn" onclick="_saveSuratStatus_(' + item.rowNumber + ')"'
          + ' class="w-full py-3 bg-primary text-white font-bold text-sm rounded-2xl active:opacity-80 transition flex items-center justify-center gap-2">'
          + '<span id="suratDetailSaveSpinner" class="hidden w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>'
          + '<span id="suratDetailSaveLabel">Simpan Update</span>'
          + '</button>'
      : '');

  modal.classList.remove('hidden');
}

function closeSuratDetail() {
  var modal = document.getElementById('suratDetailModal');
  if (modal) modal.classList.add('hidden');
}

function _saveSuratStatus_(rowNumber) {
  var status  = document.getElementById('suratDetailStatus')?.value  || '';
  var catatan = document.getElementById('suratDetailCatatan')?.value || '';
  if (!status) return;

  var btn     = document.getElementById('suratDetailSaveBtn');
  var spinner = document.getElementById('suratDetailSaveSpinner');
  var label   = document.getElementById('suratDetailSaveLabel');
  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  if (label) label.textContent = 'Menyimpan...';

  gasPost_('updateSuratPengantarStatus', {
    rowNumber  : rowNumber,
    status     : status,
    catatan    : catatan,
    adminEmail : currentUser.email
  })
  .then(function(res) {
    if (!res.ok) { throw new Error('failed'); }
    closeSuratDetail();
    showToast('Status surat diupdate!','success');
    _suratCache_ = { mine: null, all: null };
    _renderSuratPengantarPage_();
  })
  .catch(function() {
    showToast('Gagal update','error');
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
    if (label) label.textContent = 'Simpan Update';
  });
}

// ===== FITUR VOTING / POLLING DYNAMIC =====

var _votingCache_ = { list: null };
var _votingData_  = [];

function openVotingPage() {
  if (!currentUser) { openPageSaya(); return; }
  switchPage('votingPage');
  _renderVotingPage_();
}

function _renderVotingPage_() {
  var emptyState = document.getElementById('votingEmptyState');
  var loading    = document.getElementById('votingLoading');
  var list       = document.getElementById('votingList');
  var newBtn     = document.getElementById('pollNewBtn');

  var isAdmin = currentUser && currentUser.role === 'admin';
  if (newBtn) newBtn.classList.toggle('hidden', !isAdmin);
  if (newBtn) newBtn.classList.toggle('flex', isAdmin);
  if (emptyState) emptyState.classList.add('hidden');

  function paint(data) {
    _votingData_ = data || [];
    if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
    if (!_votingData_.length) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (list) list.innerHTML = '';
    } else {
      if (emptyState) emptyState.classList.add('hidden');
      _renderPollList_(_votingData_);
    }
  }

  if (_votingCache_.list !== null) {
    paint(_votingCache_.list);
  } else {
    if (loading) { loading.classList.remove('hidden'); loading.style.display = 'flex'; }
    if (list) list.innerHTML = '';
  }

  gasGet_('getPolls', { email: currentUser.email }).then(function(res) {
    if (!res.ok) { if (loading) loading.classList.add('hidden'); if (_votingCache_.list === null) showToast('Gagal memuat data','error'); return; }
    _votingCache_.list = res.data || [];
    paint(_votingCache_.list);
  }).catch(function() {
    if (loading) loading.classList.add('hidden');
    if (_votingCache_.list === null) showToast('Gagal memuat data','error');
  });
}

function _renderPollList_(data) {
  var list = document.getElementById('votingList');
  if (!list) return;
  list.innerHTML = data.map(function(p, idx) {
    var badge = p.status === 'Aktif'
      ? '<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-600">Aktif</span>'
      : '<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">Selesai</span>';
    var blokTotal = (p.myBlocks || []).length;
    var votedCount = (p.votedBlocks || []).length;
    var voteInfo = (p.status === 'Aktif' && blokTotal > 0)
      ? (votedCount >= blokTotal
          ? '<span class="text-[11px] text-blue-600 font-semibold">Sudah vote</span>'
          : '<span class="text-[11px] text-primary font-semibold">Belum vote</span>')
      : '';
    var deadlineTxt = p.deadline ? ('Deadline ' + _fmtTanggalID_(p.deadline)) : 'Tanpa deadline';
    return '<button onclick="_openPollDetail_(' + idx + ')" class="text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 active:scale-[0.99] transition">'
      + '<div class="flex items-start justify-between gap-2 mb-1">'
      + '<p class="text-sm font-bold text-gray-900 leading-snug">' + _esc_(p.judul) + '</p>' + badge
      + '</div>'
      + (p.deskripsi ? '<p class="text-xs text-gray-500 leading-relaxed mb-2 line-clamp-2">' + _esc_(p.deskripsi) + '</p>' : '')
      + '<div class="flex items-center justify-between mt-1">'
      + '<span class="text-[11px] text-gray-400">' + _esc_(deadlineTxt) + ' · ' + p.totalSuara + ' suara</span>'
      + voteInfo
      + '</div>'
      + '</button>';
  }).join('');
}

function _fmtTanggalID_(ymd) {
  // 'yyyy-MM-dd' -> 'dd Mmm yyyy'
  if (!ymd) return '';
  var parts = String(ymd).split('-');
  if (parts.length !== 3) return ymd;
  var bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return parseInt(parts[2],10) + ' ' + (bln[parseInt(parts[1],10)-1]||'') + ' ' + parts[0];
}

// -- BUAT POLL (ADMIN) --
function openPollForm() {
  document.getElementById('pollJudul').value = '';
  document.getElementById('pollDeskripsi').value = '';
  document.getElementById('pollDeadline').value = '';
  var single = document.querySelector('input[name="pollType"][value="single"]');
  if (single) single.checked = true;
  var err = document.getElementById('pollFormError');
  if (err) err.classList.add('hidden');
  var wrap = document.getElementById('pollOptionsWrap');
  wrap.innerHTML = '';
  addPollOption(); addPollOption();
  document.getElementById('pollFormSheet').classList.remove('hidden');
}

function closePollForm() {
  document.getElementById('pollFormSheet').classList.add('hidden');
}

function addPollOption() {
  var wrap = document.getElementById('pollOptionsWrap');
  var row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  row.innerHTML = '<input type="text" autocomplete="off" placeholder="Nama opsi/kandidat" class="app-input poll-option-input flex-1"/>'
    + '<button type="button" onclick="this.parentElement.remove()" class="w-9 h-9 flex-shrink-0 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 active:bg-gray-200">'
    + '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
  wrap.appendChild(row);
}

function submitCreatePoll() {
  var judul = document.getElementById('pollJudul').value.trim();
  var deskripsi = document.getElementById('pollDeskripsi').value.trim();
  var deadline = document.getElementById('pollDeadline').value;
  var type = (document.querySelector('input[name="pollType"]:checked') || {}).value || 'single';
  var options = Array.prototype.map.call(document.querySelectorAll('.poll-option-input'), function(i){ return i.value.trim(); }).filter(Boolean);
  var err = document.getElementById('pollFormError');
  function showErr(m){ if (err){ err.textContent = m; err.classList.remove('hidden'); } }

  if (!judul) return showErr('Judul wajib diisi.');
  if (options.length < 2) return showErr('Minimal 2 opsi.');

  var btn = document.getElementById('pollSubmitBtn');
  var spinner = document.getElementById('pollSubmitSpinner');
  var label = document.getElementById('pollSubmitLabel');
  btn.disabled = true; spinner.classList.remove('hidden'); label.textContent = 'Menyimpan...';

  gasPost_('createPoll', {
    adminEmail: currentUser.email,
    payload: { judul: judul, deskripsi: deskripsi, options: options, type: type, deadline: deadline }
  }).then(function(res) {
    btn.disabled = false; spinner.classList.add('hidden'); label.textContent = 'Buat Voting';
    if (!res.ok) return showErr(res.error || 'Gagal membuat poll.');
    closePollForm();
    showToast('Voting dibuat!', 'success');
    _votingCache_.list = null;
    _renderVotingPage_();
  }).catch(function() {
    btn.disabled = false; spinner.classList.add('hidden'); label.textContent = 'Buat Voting';
    showErr('Gagal membuat poll.');
  });
}

// -- DETAIL / VOTE --
function closePollDetail() {
  document.getElementById('pollDetailModal').classList.add('hidden');
}

function _openPollDetail_(idx) {
  var p = _votingData_[idx];
  if (!p) return;
  _renderPollDetail_(p);
  document.getElementById('pollDetailModal').classList.remove('hidden');
}

function _pollResultsChartHtml_(options, total) {
  var max = total || options.reduce(function(s,o){ return s + (o.count||0); }, 0) || 1;
  return '<div class="flex flex-col gap-2.5">' + options.map(function(o) {
    var c = o.count || 0;
    var pct = max ? Math.round(c / max * 100) : 0;
    return '<div>'
      + '<div class="flex items-center justify-between mb-1">'
      + '<span class="text-sm text-gray-700">' + _esc_(o.label) + '</span>'
      + '<span class="text-xs font-semibold text-gray-500">' + c + ' · ' + pct + '%</span>'
      + '</div>'
      + '<div class="h-2.5 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full bg-primary transition-all" style="width:' + pct + '%"></div></div>'
      + '</div>';
  }).join('') + '</div>';
}

function _renderPollDetail_(p) {
  var body = document.getElementById('pollDetailBody');
  var isAdmin = currentUser && currentUser.role === 'admin';
  var statusBadge = p.status === 'Aktif'
    ? '<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 flex-shrink-0">Aktif</span>'
    : '<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">Selesai</span>';

  var myBlocks = p.myBlocks || [];
  var voted = p.votedBlocks || [];
  var notVoted = myBlocks.filter(function(b){ return voted.indexOf(b) === -1; });
  var canVote = p.status === 'Aktif' && notVoted.length > 0;

  var html = ''
    + '<div class="flex items-start justify-between gap-2">'
    + '<div><p class="text-base font-bold text-gray-900 leading-snug">' + _esc_(p.judul) + '</p>'
    + '<p class="text-[11px] text-gray-400 mt-0.5">' + (p.deadline ? 'Deadline ' + _esc_(_fmtTanggalID_(p.deadline)) : 'Tanpa deadline') + ' · ' + (p.type === 'multi' ? 'Pilih banyak' : 'Pilih satu') + '</p></div>'
    + statusBadge + '</div>'
    + (p.deskripsi ? '<p class="text-sm text-gray-600 leading-relaxed">' + _esc_(p.deskripsi) + '</p>' : '');

  if (canVote) {
    var inputType = p.type === 'multi' ? 'checkbox' : 'radio';
    html += '<div class="rounded-2xl bg-gray-50 border border-gray-100 p-3 space-y-3" id="pollVoteSection">';
    if (notVoted.length > 1) {
      html += '<div><p class="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Voting atas nama blok</p>'
        + '<select id="pollVoteBlok" class="app-input">'
        + notVoted.map(function(b){ return '<option value="' + _esc_(b) + '">Blok ' + _esc_(b) + '</option>'; }).join('')
        + '</select></div>';
    } else {
      html += '<input type="hidden" id="pollVoteBlok" value="' + _esc_(notVoted[0]) + '"/>'
        + '<p class="text-[11px] text-gray-400">Voting atas nama Blok ' + _esc_(notVoted[0]) + '</p>';
    }
    html += '<div class="space-y-2">' + p.options.map(function(o) {
      return '<label class="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-gray-200 cursor-pointer active:bg-gray-50">'
        + '<input type="' + inputType + '" name="pollChoice" value="' + _esc_(o.label) + '" class="accent-primary w-4 h-4"/>'
        + '<span class="text-sm text-gray-800">' + _esc_(o.label) + '</span></label>';
    }).join('') + '</div>';
    html += '<button id="pollVoteBtn" onclick="_submitVote_(\'' + _esc_(p.id) + '\')" class="w-full py-3 bg-primary text-white font-bold text-sm rounded-2xl active:opacity-80 transition flex items-center justify-center gap-2">'
      + '<span id="pollVoteSpinner" class="hidden w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>'
      + '<span id="pollVoteLabel">Kirim Suara</span></button>';
    html += '</div>';
  } else if (p.status === 'Aktif' && myBlocks.length > 0 && notVoted.length === 0) {
    html += '<p class="text-xs text-center text-blue-600 font-semibold bg-blue-50 rounded-xl py-2">Anda sudah memberikan suara untuk semua blok Anda. Terima kasih!</p>';
  } else if (p.status !== 'Aktif') {
    html += '<p class="text-xs text-center text-gray-400 bg-gray-50 rounded-xl py-2">Voting sudah ditutup.</p>';
  } else if (myBlocks.length === 0) {
    html += '<p class="text-xs text-center text-gray-400 bg-gray-50 rounded-xl py-2">Hanya warga terdaftar (punya blok) yang bisa memberikan suara.</p>';
  }

  html += '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-2">Hasil Sementara · ' + p.totalSuara + ' suara</p>'
    + '<div id="pollResultsChart">' + _pollResultsChartHtml_(p.options, p.totalSuara) + '</div></div>';

  if (isAdmin) {
    // Rincian suara per blok (siapa milih apa)
    html += '<div class="pt-1">'
      + '<button id="pollDetailRincianBtn" onclick="_loadPollVoteDetails_(\'' + _esc_(p.id) + '\')" '
      + 'class="w-full py-2.5 rounded-xl bg-blue-50 text-blue-600 text-sm font-semibold active:bg-blue-100 flex items-center justify-center gap-1.5">'
      + '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      + 'Lihat rincian suara per blok</button>'
      + '<div id="pollVoteDetailList" class="mt-2"></div>'
      + '</div>';

    html += '<div class="flex gap-2 pt-1">';
    if (p.status === 'Aktif') {
      html += '<button onclick="_closePoll_(\'' + _esc_(p.id) + '\')" class="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold active:bg-gray-200">Tutup Voting</button>';
    }
    html += '<button onclick="_deletePoll_(\'' + _esc_(p.id) + '\')" class="flex-1 py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-semibold active:bg-red-100">Hapus</button>';
    html += '</div>';
  }

  body.innerHTML = html;
}

// Admin: muat rincian suara per blok (siapa memilih apa)
function _loadPollVoteDetails_(pollId) {
  var box = document.getElementById('pollVoteDetailList');
  if (!box) return;
  box.innerHTML = '<p class="text-xs text-gray-400 text-center py-3">Memuat rincian...</p>';
  gasGet_('getPollVoteDetails', { pollId: pollId, adminEmail: (currentUser && currentUser.email) || '' })
    .then(function(res) {
      if (!res || !res.ok) {
        box.innerHTML = '<p class="text-xs text-red-400 text-center py-3">' + _esc_((res && res.error) || 'Gagal memuat') + '</p>';
        return;
      }
      var rows = res.votes || [];
      if (!rows.length) {
        box.innerHTML = '<p class="text-xs text-gray-400 text-center py-3 bg-gray-50 rounded-xl">Belum ada suara tercatat.</p>';
        return;
      }
      var anonCount = 0;
      var items = rows.map(function(v) {
        var pilihan = v.pilihan
          ? '<span class="text-sm font-semibold text-gray-800">' + _esc_(v.pilihan) + '</span>'
          : (anonCount++, '<span class="text-xs text-gray-300 italic">anonim (vote lama)</span>');
        return '<div class="flex items-center justify-between gap-2 px-3 py-2.5">'
          + '<span class="text-sm text-gray-600">Blok ' + _esc_(v.blok) + '</span>'
          + pilihan + '</div>';
      }).join('');
      var note = anonCount
        ? '<p class="text-[10px] text-gray-400 mt-1 px-1">' + anonCount + ' suara lama tercatat anonim (sebelum fitur rincian aktif).</p>'
        : '';
      box.innerHTML = '<div class="rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">' + items + '</div>' + note;
    })
    .catch(function() {
      box.innerHTML = '<p class="text-xs text-red-400 text-center py-3">Gagal memuat</p>';
    });
}

function _submitVote_(pollId) {
  var blok = (document.getElementById('pollVoteBlok') || {}).value || '';
  var checked = Array.prototype.map.call(document.querySelectorAll('input[name="pollChoice"]:checked'), function(i){ return i.value; });
  if (!checked.length) { showToast('Pilih opsi dulu', 'error'); return; }

  var btn = document.getElementById('pollVoteBtn');
  var spinner = document.getElementById('pollVoteSpinner');
  var label = document.getElementById('pollVoteLabel');
  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  if (label) label.textContent = 'Mengirim...';

  gasPost_('submitVote', {
    email: currentUser.email,
    payload: { pollId: pollId, blok: blok, choices: checked }
  }).then(function(res) {
    if (!res.ok) {
      showToast(res.error || 'Gagal vote', 'error');
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (label) label.textContent = 'Kirim Suara';
      return;
    }
    showToast('Suara terkirim!', 'success');
    _votingCache_.list = null;
    gasGet_('getPolls', { email: currentUser.email }).then(function(r2) {
      _votingCache_.list = r2.data || [];
      _votingData_ = _votingCache_.list;
      _renderPollList_(_votingData_);
      var updated = _votingData_.filter(function(x){ return x.id === pollId; })[0];
      if (updated) _renderPollDetail_(updated);
    });
  }).catch(function() {
    showToast('Gagal vote', 'error');
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
    if (label) label.textContent = 'Kirim Suara';
  });
}

function _closePoll_(pollId) {
  if (!confirm('Tutup voting ini? Warga tidak bisa vote lagi.')) return;
  gasPost_('closePoll', { pollId: pollId, adminEmail: currentUser.email }).then(function(res) {
    if (!res.ok) { showToast(res.error || 'Gagal', 'error'); return; }
    showToast('Voting ditutup', 'success');
    _votingCache_.list = null;
    closePollDetail();
    _renderVotingPage_();
  });
}

function _deletePoll_(pollId) {
  if (!confirm('Hapus voting ini beserta semua suaranya? Tidak bisa dibatalkan.')) return;
  gasPost_('deletePoll', { pollId: pollId, adminEmail: currentUser.email }).then(function(res) {
    if (!res.ok) { showToast(res.error || 'Gagal', 'error'); return; }
    showToast('Voting dihapus', 'success');
    _votingCache_.list = null;
    closePollDetail();
    _renderVotingPage_();
  });
}

// ===== FITUR DAFTAR WARGA =====

function openDaftarSheet() {
  var sheet = document.getElementById('daftarFormSheet');
  if (!sheet) return;
  // Reset to form state
  document.getElementById('daftarFormBody').classList.remove('hidden');
  document.getElementById('daftarSuccessBody').classList.add('hidden');
  // Clear fields
  var n = document.getElementById('daftarNama'); if (n) n.value = '';
  var b = document.getElementById('daftarBlok'); if (b) b.value = '';
  var w = document.getElementById('daftarWA'); if (w) w.value = '';
  var s = document.querySelectorAll('input[name="daftarStatus"]');
  s.forEach(function(r) { r.checked = false; });
  var err = document.getElementById('daftarError');
  if (err) { err.classList.add('hidden'); err.querySelector('span').textContent = ''; }
  var btn = document.getElementById('daftarSubmitBtn');
  if (btn) { btn.disabled = false; btn.innerHTML = 'Kirim Pengajuan'; }
  // Reset blok lookup state
  if (_daftarBlokLookupTimer_) { clearTimeout(_daftarBlokLookupTimer_); _daftarBlokLookupTimer_ = null; }
  var info = document.getElementById('daftarBlokInfo');
  if (info) { info.classList.add('hidden'); info.innerHTML = ''; }
  var fmtErr = document.getElementById('daftarBlokFormatError');
  if (fmtErr) fmtErr.classList.add('hidden');
  sheet.classList.remove('hidden');
}

function closeDaftarSheet() {
  var sheet = document.getElementById('daftarFormSheet');
  if (sheet) sheet.classList.add('hidden');
}

// ===== BLOK LOOKUP (Daftar Akun Warga) =====
var _daftarBlokLookupTimer_ = null;
var _DAFTAR_BLOK_FORMAT_RE_ = /^[A-Z][0-9]{1,3}[A-Z]?$/;

function onDaftarBlokInput() {
  var input = document.getElementById('daftarBlok');
  var info  = document.getElementById('daftarBlokInfo');
  var fmtErr = document.getElementById('daftarBlokFormatError');
  if (!input) return;

  // Force uppercase as user types
  var cursor = input.selectionStart;
  input.value = input.value.toUpperCase();
  if (cursor !== null) input.setSelectionRange(cursor, cursor);

  var val = input.value.trim();

  if (info) { info.classList.add('hidden'); info.innerHTML = ''; }
  if (fmtErr) fmtErr.classList.add('hidden');

  if (_daftarBlokLookupTimer_) { clearTimeout(_daftarBlokLookupTimer_); _daftarBlokLookupTimer_ = null; }

  if (!val) return;

  if (!_DAFTAR_BLOK_FORMAT_RE_.test(val)) {
    if (fmtErr) fmtErr.classList.remove('hidden');
    return;
  }

  _daftarBlokLookupTimer_ = setTimeout(function() {
    gasGet_('getResidentByBlock', { blok: val })
      .then(function(res) {
        // Ignore stale responses if the user kept typing
        if (input.value.trim() !== val) return;
        if (!info) return;
        if (res && res.found) {
          info.className = 'rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-700';
          info.innerHTML = 'Rumah <strong>' + val + '</strong> tercatat atas nama <strong>' + (res.nama || '-') + '</strong>. ' +
            'Jika kamu penghuni baru atau pindah, lanjutkan isi data kamu di bawah.';
        } else {
          info.className = 'rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-700';
          info.innerHTML = 'Blok <strong>' + val + '</strong> belum ada di data warga. Lanjutkan isi data kamu di bawah untuk pengajuan pertama.';
        }
        info.classList.remove('hidden');
      })
      .catch(function() {});
  }, 300);
}

function submitDaftarForm() {
  var nama   = (document.getElementById('daftarNama')?.value || '').trim();
  var blok   = (document.getElementById('daftarBlok')?.value || '').trim().toUpperCase();
  var email  = (document.getElementById('daftarEmail')?.value || '').trim().toLowerCase();
  var waRaw  = (document.getElementById('daftarWA')?.value || '').trim().replace(/\D/g, '');
  var wa     = waRaw ? '62' + waRaw.replace(/^0+/, '') : '';
  var status = document.querySelector('input[name="daftarStatus"]:checked')?.value || '';

  var errEl   = document.getElementById('daftarError');
  var errSpan = errEl?.querySelector('span');

  function showErr(msg) {
    if (errEl && errSpan) {
      errSpan.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  if (!blok)   { showErr('Blok rumah wajib diisi.'); return; }
  if (!VALID_BLOK_LIST.includes(blok)) { showErr('Nomor blok tidak ditemukan. Periksa kembali blok rumah kamu.'); return; }
  if (!nama)   { showErr('Nama lengkap wajib diisi.'); return; }
  if (!email)  { showErr('Email wajib diisi.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Format email tidak valid.'); return; }
  if (!waRaw)  { showErr('No. WhatsApp wajib diisi.'); return; }
  if (!status) { showErr('Status hunian wajib dipilih.'); return; }

  if (errEl) errEl.classList.add('hidden');

  var btn = document.getElementById('daftarSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block mr-2 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Mengirim...';
  }

  gasPost_('registerWarga', { nama: nama, blok: blok, email: email, wa: wa, status: status })
    .then(function(res) {
      if (!res.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Kirim Pengajuan'; }
        showErr(res.message || 'Gagal mengirim pengajuan. Coba lagi.');
        return;
      }
      // Show success
      document.getElementById('daftarFormBody').classList.add('hidden');
      document.getElementById('daftarSuccessBody').classList.remove('hidden');
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Kirim Pengajuan'; }
      showErr('Gagal mengirim. Periksa koneksi internet kamu.');
    });
}

// ===== ADMIN: WARGA BARU =====

var _pendingAktifkanRow_ = null;

function loadWargaBaru() {
  var loading = document.getElementById('wargaBaruLoading');
  var empty   = document.getElementById('wargaBaruEmpty');
  var list    = document.getElementById('wargaBaruList');
  if (!list) return;

  if (loading) { loading.classList.remove('hidden'); loading.classList.add('flex'); }
  if (empty)   empty.classList.add('hidden');
  list.innerHTML = '';

  gasGet_('getPendingRegistrations', { email: currentUser.email })
    .then(function(res) {
      if (loading) { loading.classList.add('hidden'); loading.classList.remove('flex'); }
      if (!res || !res.ok || !res.data || res.data.length === 0) {
        if (empty) empty.classList.remove('hidden');
        _updateWargaBaruBadge_(0);
        return;
      }
      _updateWargaBaruBadge_(res.data.length);
      list.innerHTML = res.data.map(function(w) {
        return '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">' +
          '<div class="flex items-start justify-between gap-2 mb-3">' +
            '<div class="flex items-center gap-2.5">' +
              '<div class="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">' +
                '<svg class="w-4.5 h-4.5 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '</div>' +
              '<div>' +
                '<p class="text-sm font-bold text-gray-900">' + _esc_(w.nama) + '</p>' +
                '<p class="text-xs text-gray-400">' + _esc_(w.blok) + ' · ' + _esc_(w.statusHunian) + '</p>' +
              '</div>' +
            '</div>' +
            '<span class="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 font-semibold px-2 py-1 rounded-full flex-shrink-0">Belum Aktif</span>' +
          '</div>' +
          '<div class="space-y-1.5 mb-3">' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>' +
              '<span class="truncate">' + _esc_(w.email) + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 10 19.79 19.79 0 0 1 1.61 1.4 2 2 0 0 1 3.6 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 7.91a16 16 0 0 0 6.29 6.29l1.07-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
              '<span>' + _esc_(w.noHp) + '</span>' +
            '</div>' +
            (w.submittedAt ? '<div class="flex items-center gap-2 text-xs text-gray-400">' +
              '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' +
              '<span>Daftar: ' + _esc_(w.submittedAt) + '</span>' +
            '</div>' : '') +
          '</div>' +
          '<button onclick="konfirmasiAktifkan(' + w.rowNumber + ',\'' + _esc_(w.nama) + '\',\'' + _esc_(w.blok) + '\')"' +
                  ' class="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl active:scale-95 transition shadow-sm shadow-primary/20">' +
            '<svg class="w-4 h-4 inline-block mr-1.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan Akun' +
          '</button>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      if (loading) { loading.classList.add('hidden'); loading.classList.remove('flex'); }
      if (list) list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>';
    });
}

function _updateWargaBaruBadge_(count) {
  var badge = document.getElementById('wargaBaruTabCount');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
    badge.className = 'px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold';
  } else {
    badge.classList.add('hidden');
  }
}

var _aktifkanFromCRUD_ = false;

function konfirmasiAktifkan(rowNumber, nama, blok, fromCRUD) {
  _pendingAktifkanRow_ = rowNumber;
  _aktifkanFromCRUD_   = !!fromCRUD;
  var desc = document.getElementById('modalAktifkanDesc');
  if (desc) desc.textContent = nama + ' (Blok ' + blok + ') akan bisa login setelah diaktifkan.';
  var modal = document.getElementById('modalAktifkanWarga');
  if (modal) modal.classList.remove('hidden');
}

function closeModalAktifkan() {
  var modal = document.getElementById('modalAktifkanWarga');
  if (modal) modal.classList.add('hidden');
  _pendingAktifkanRow_ = null;
}

function doAktifkanWarga() {
  if (!_pendingAktifkanRow_) return;
  var btn = document.getElementById('btnDoAktifkan');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Memproses...</span>'; }

  gasPost_('activateUser', { rowNumber: _pendingAktifkanRow_, adminEmail: currentUser.email })
    .then(function(res) {
      closeModalAktifkan();
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan'; }
      if (!res.ok) { showToast(res.message || 'Gagal mengaktifkan', 'error'); return; }
      showToast('Akun berhasil diaktifkan! WA terkirim ke warga.', 'success');
      // Bust warga baru cache so next open is fresh
      _adminWargaBaruCache_ = null; sessionStorage.removeItem('exploreWargaBaruCache');
      if (_aktifkanFromCRUD_) {
        _loadWargaBaruCRUDList_();
        loadAdminWargaBaruPreview();
      } else {
        loadWargaBaru();
      }
    })
    .catch(function() {
      closeModalAktifkan();
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan'; }
      showToast('Gagal mengaktifkan akun', 'error');
    });
}

// ===== ADMIN PANEL: WARGA BARU PREVIEW =====

function _renderAdminWargaBaruPreview_(res) {
  var el    = document.getElementById('adminWargaBaruPreviewList');
  var badge = document.getElementById('adminWargaBadge');
  if (!el) return;
  if (!res || !res.ok || !res.data || res.data.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-1 text-center">Tidak ada pengajuan baru</p>';
    if (badge) badge.classList.add('hidden');
    var sc = document.getElementById('scAdminWargaBaru'); if (sc) sc.textContent = '0';
    return;
  }
  var count = res.data.length;
  if (badge) { badge.textContent = count; badge.classList.remove('hidden'); }
  var sc = document.getElementById('scAdminWargaBaru'); if (sc) sc.textContent = count;
  var preview = res.data.slice(0, 3).map(function(w) {
    return '<div class="flex items-center justify-between py-1">' +
      '<div><span class="text-xs font-semibold text-gray-800">' + _esc_(w.nama) + '</span>' +
      '<span class="text-[10px] text-gray-400 ml-1.5">Blok ' + _esc_(w.blok) + ' · ' + _esc_(w.statusHunian) + '</span></div>' +
      '<span class="text-[10px] bg-orange-50 text-orange-600 border border-orange-100 font-semibold px-1.5 py-0.5 rounded-full">Pending</span>' +
    '</div>';
  }).join('');
  if (count > 3) preview += '<p class="text-[10px] text-gray-400 mt-0.5">+' + (count-3) + ' lainnya</p>';
  el.innerHTML = preview;
}

function loadAdminWargaBaruPreview() {
  var el = document.getElementById('adminWargaBaruPreviewList');
  if (!el || !currentUser) return;

  // Return from cache if available
  if (_adminWargaBaruCache_) { _renderAdminWargaBaruPreview_(_adminWargaBaruCache_); return; }
  var cached = _ssGetExplore_('exploreWargaBaruCache');
  if (cached) { _adminWargaBaruCache_ = cached; _renderAdminWargaBaruPreview_(cached); return; }

  gasGet_('getPendingRegistrations', { email: currentUser.email })
    .then(function(res) {
      _adminWargaBaruCache_  = res;
      _ssSetExplore_('exploreWargaBaruCache', res);
      _renderAdminWargaBaruPreview_(res);
    })
    .catch(function() {
      el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
    });
}

function openDashboardWargaBaru() {
  openWargaBaruCRUD(); // redirect to modal instead
}

function openWargaBaruCRUD() {
  var modal = document.getElementById('wargaBaruCRUDModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Use cache if available — only fetch on first open or after cache bust
  if (_adminWargaBaruCache_ && _adminWargaBaruCache_.data) {
    _renderWargaBaruCRUDFromCache_(_adminWargaBaruCache_.data);
  } else {
    _loadWargaBaruCRUDList_();
  }
}

function closeWargaBaruCRUD() {
  var modal = document.getElementById('wargaBaruCRUDModal');
  if (modal) modal.classList.add('hidden');
}

function _loadWargaBaruCRUDList_() {
  var el    = document.getElementById('wargaBaruCRUDList');
  var badge = document.getElementById('wargaBaruCRUDBadge');
  if (!el) return;

  el.innerHTML = '<div class="space-y-2 py-1">' + '<div class="skeleton rounded-2xl" style="height:62px"></div>'.repeat(5) + '</div>';

  gasGet_('getPendingRegistrations', { email: currentUser.email })
    .then(function(res) {
      _adminWargaBaruCache_ = res;
      _ssSetExplore_('exploreWargaBaruCache', res);
      _renderWargaBaruCRUDFromCache_(res && res.data ? res.data : []);
    })
    .catch(function() {
      var el = document.getElementById('wargaBaruCRUDList');
      if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>';
    });
}

function _renderWargaBaruCRUDFromCache_(data) {
  var el    = document.getElementById('wargaBaruCRUDList');
  var badge = document.getElementById('wargaBaruCRUDBadge');
  if (!el) return;

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="flex flex-col items-center justify-center py-12 gap-3 text-center">' +
      '<div class="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500">Tidak ada pengajuan baru</p>' +
      '<p class="text-xs text-gray-400">Semua pengajuan sudah diproses</p>' +
    '</div>';
    if (badge) badge.classList.add('hidden');
    return;
  }

  var count = data.length;
  if (badge) { badge.textContent = count; badge.classList.remove('hidden'); }

  el.innerHTML = data.map(function(w) {
        return '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">' +
          '<div class="flex items-start justify-between gap-2 mb-3">' +
            '<div class="flex items-center gap-2.5">' +
              '<div class="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">' +
                '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '</div>' +
              '<div>' +
                '<p class="text-sm font-bold text-gray-900">' + _esc_(w.nama) + '</p>' +
                '<p class="text-xs text-gray-400">Blok ' + _esc_(w.blok) + ' · ' + _esc_(w.statusHunian) + '</p>' +
              '</div>' +
            '</div>' +
            '<span class="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 font-semibold px-2 py-1 rounded-full flex-shrink-0">Belum Aktif</span>' +
          '</div>' +
          '<div class="space-y-1.5 mb-3">' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>' +
              '<span class="truncate">' + _esc_(w.email) + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 10 19.79 19.79 0 0 1 1.61 1.4 2 2 0 0 1 3.6 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 7.91a16 16 0 0 0 6.29 6.29l1.07-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
              '<span>' + _esc_(w.noHp) + '</span>' +
            '</div>' +
            (w.submittedAt ? '<div class="flex items-center gap-2 text-xs text-gray-400">' +
              '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' +
              '<span>Daftar: ' + _esc_(w.submittedAt) + '</span>' +
            '</div>' : '') +
          '</div>' +
          '<button onclick="konfirmasiAktifkan(' + w.rowNumber + ',\'' + _esc_(w.nama) + '\',\'' + _esc_(w.blok) + '\',true)"' +
                  ' class="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl active:scale-95 transition shadow-sm shadow-primary/20">' +
            '<svg class="w-4 h-4 inline-block mr-1.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan Akun' +
          '</button>' +
        '</div>';
  }).join('');
}

// ===== ADMIN: KELOLA PENGADUAN =====

var _adminLaporData_  = [];
var _adminLaporTab_   = 'all';

var _LAPOR_STATUS_CFG_ = {
  'Masuk'    : { bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    dotCls: 'bg-red-500' },
  'Diproses' : { bg: 'bg-blue-50',   text: 'text-blue-600',   border: 'border-blue-200',   dotCls: 'bg-blue-500' },
  'Selesai'  : { bg: 'bg-blue-50',  text: 'text-blue-700',  border: 'border-blue-200',  dotCls: 'bg-blue-500' },
  'Ditolak'  : { bg: 'bg-gray-100',  text: 'text-gray-500',   border: 'border-gray-200',   dotCls: 'bg-gray-400' }
};
function _statusDot_(cfg) { return '<span class="inline-block w-2 h-2 rounded-full flex-shrink-0 ' + (cfg.dotCls||'bg-gray-400') + '"></span>'; }

function _renderAdminLaporPreview_(res) {
  var el    = document.getElementById('adminLaporPreviewList');
  var badge = document.getElementById('adminLaporBadge');
  if (!el) return;
  if (!res || !res.ok || !res.data || res.data.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada laporan</p>';
    if (badge) badge.classList.add('hidden');
    return;
  }
  var pending = res.data.filter(function(d) { return d.status === 'Masuk'; });
  if (badge && pending.length > 0) {
    badge.textContent = pending.length; badge.classList.remove('hidden');
  } else if (badge) { badge.classList.add('hidden'); }
  var scMasuk = document.getElementById('scAdminLaporMasuk');
  var scTotal = document.getElementById('scAdminLaporTotal');
  if (scMasuk) scMasuk.textContent = pending.length;
  if (scTotal) scTotal.textContent = '/ ' + res.data.length;
  var counts = {};
  res.data.forEach(function(d) { counts[d.status] = (counts[d.status]||0)+1; });
  el.innerHTML = Object.keys(counts).map(function(s) {
    var cfg = _LAPOR_STATUS_CFG_[s] || {};
    return '<div class="flex items-center justify-between py-1">' +
      '<span class="text-xs text-gray-700 flex items-center gap-1.5">' + _statusDot_(cfg) + ' ' + s + '</span>' +
      '<span class="text-xs font-bold text-gray-900">' + counts[s] + '</span>' +
    '</div>';
  }).join('');
}

function loadAdminLaporPreview() {
  var el = document.getElementById('adminLaporPreviewList');
  if (!el || !currentUser) return;

  // Return from cache if available
  if (_adminLaporCache_) { _renderAdminLaporPreview_(_adminLaporCache_); return; }
  var cached = _ssGetExplore_('exploreLaporCache');
  if (cached) { _adminLaporCache_ = cached; _renderAdminLaporPreview_(cached); return; }

  gasGet_('getPengaduanList', { email: currentUser.email, isAdmin: 'true' })
    .then(function(res) {
      _adminLaporCache_ = res;
      _ssSetExplore_('exploreLaporCache', res);
      _renderAdminLaporPreview_(res);
    })
    .catch(function() {
      el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
    });
}

function openAdminPengaduan() {
  var modal = document.getElementById('adminPengaduanModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  _adminLaporTab_ = 'all';
  _setAdminLaporTabUI_('all');
  // Use cache if available — only fetch on first open or after cache bust
  if (_adminLaporCache_ && _adminLaporCache_.data) {
    _adminLaporData_ = _adminLaporCache_.data;
    _renderAdminPengaduanList_();
  } else {
    _loadAdminPengaduanList_();
  }
}

function closeAdminPengaduan() {
  var modal = document.getElementById('adminPengaduanModal');
  if (modal) modal.classList.add('hidden');
}

function switchAdminLaporTab(tab) {
  _adminLaporTab_ = tab;
  _setAdminLaporTabUI_(tab);
  _renderAdminPengaduanList_();
}

function _setAdminLaporTabUI_(active) {
  var tabs = ['all','Masuk','Diproses','Selesai','Ditolak'];
  var ids  = { all:'apTab_all', Masuk:'apTab_masuk', Diproses:'apTab_diproses', Selesai:'apTab_selesai', Ditolak:'apTab_ditolak' };
  tabs.forEach(function(t) {
    var el = document.getElementById(ids[t]);
    if (!el) return;
    if (t === active) {
      el.className = 'admin-lapor-tab flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-800 text-white transition';
    } else {
      el.className = 'admin-lapor-tab flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 text-gray-500 transition';
    }
  });
}

function _loadAdminPengaduanList_() {
  var el = document.getElementById('adminPengaduanList');
  if (!el) return;
  el.innerHTML = '<div class="space-y-2 py-1">' + '<div class="skeleton rounded-2xl" style="height:62px"></div>'.repeat(5) + '</div>';

  gasGet_('getPengaduanList', { email: currentUser.email, isAdmin: 'true' })
    .then(function(res) {
      if (!res || !res.ok) { el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>'; return; }
      _adminLaporData_ = res.data || [];
      _renderAdminPengaduanList_();
    })
    .catch(function() { el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>'; });
}

function _renderAdminPengaduanList_() {
  var el   = document.getElementById('adminPengaduanList');
  if (!el) return;

  var data = _adminLaporTab_ === 'all'
    ? _adminLaporData_
    : _adminLaporData_.filter(function(d) { return d.status === _adminLaporTab_; });

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="flex flex-col items-center justify-center py-12 gap-3 text-center">' +
      '<div class="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500">Tidak ada laporan</p>' +
    '</div>';
    return;
  }

  el.innerHTML = data.map(function(item, idx) {
    var cfg = _LAPOR_STATUS_CFG_[item.status] || _LAPOR_STATUS_CFG_['Masuk'];
    var realIdx = _adminLaporData_.indexOf(item);
    return '<div onclick="openAdminPengaduanDetail(' + realIdx + ')"' +
           ' class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer active:opacity-75 transition">' +
      '<div class="flex items-start justify-between gap-2 mb-2">' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold text-gray-900 truncate">' + _esc_(item.judul) + '</p>' +
          '<p class="text-xs text-gray-400 mt-0.5">' + _esc_(item.nama) + ' · Blok ' + _esc_(item.unit) + '</p>' +
        '</div>' +
        '<span class="text-[10px] font-bold px-2 py-1 rounded-full border flex-shrink-0 flex items-center gap-1 ' + cfg.bg + ' ' + cfg.text + ' ' + cfg.border + '">' +
          _statusDot_(cfg) + ' ' + item.status +
        '</span>' +
      '</div>' +
      '<div class="flex items-center gap-2 flex-wrap">' +
        '<span class="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>' +
        '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>' +
        (item.handler ? '<span class="text-[11px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full">→ ' + _esc_(item.handler) + '</span>' : '') +
      '</div>' +
      (item.catatan ? '<p class="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-1.5 mt-2 line-clamp-1">' + _esc_(item.catatan) + '</p>' : '') +
    '</div>';
  }).join('');
}

function openAdminPengaduanDetail(idx) {
  var item = _adminLaporData_[idx];
  if (!item) return;
  var modal = document.getElementById('adminPengaduanDetailModal');
  var body  = document.getElementById('adminPengaduanDetailBody');
  if (!modal || !body) return;

  var statusOptions = ['Masuk','Diproses','Selesai','Ditolak'];
  var cfg = _LAPOR_STATUS_CFG_[item.status] || _LAPOR_STATUS_CFG_['Masuk'];

  body.innerHTML =
    '<div class="flex items-center gap-2 flex-wrap">' +
      '<span class="text-[10px] font-bold px-2 py-1 rounded-full border flex items-center gap-1 ' + cfg.bg + ' ' + cfg.text + ' ' + cfg.border + '">' + _statusDot_(cfg) + ' ' + item.status + '</span>' +
      '<span class="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>' +
      '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>' +
    '</div>' +
    '<div class="bg-gray-50 rounded-2xl p-3 space-y-2">' +
      '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest">ID</p><p class="text-xs font-mono text-gray-700">' + _esc_(item.id) + '</p></div>' +
      '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest">Pelapor</p><p class="text-sm font-semibold text-gray-900">' + _esc_(item.nama) + ' · Blok ' + _esc_(item.unit) + '</p></div>' +
    '</div>' +
    '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Judul</p><p class="text-sm font-semibold text-gray-900">' + _esc_(item.judul) + '</p></div>' +
    '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Deskripsi</p><p class="text-sm text-gray-700 leading-relaxed">' + _esc_(item.deskripsi) + '</p></div>' +
    '<div>' +
      '<p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Update Status</p>' +
      '<div class="grid grid-cols-2 gap-2">' +
        statusOptions.map(function(s) {
          var c = _LAPOR_STATUS_CFG_[s];
          var isActive = item.status === s;
          return '<button onclick="_quickSetLaporStatus_(' + item.rowNumber + ',\'' + s + '\',' + idx + ')"' +
            ' class="py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 flex items-center justify-center gap-1.5 ' +
            (isActive ? c.bg + ' ' + c.text + ' ' + c.border : 'bg-gray-50 text-gray-400 border-gray-200') + '">' +
            _statusDot_(c) + ' ' + s +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div>' +
      '<p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Catatan untuk Warga</p>' +
      '<textarea id="adminLaporCatatan" rows="3" placeholder="Misal: sudah dikonfirmasi ke petugas..."' +
        ' class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none resize-none">' +
        _esc_(item.catatan || '') + '</textarea>' +
    '</div>' +
    '<button onclick="_saveAdminLaporStatus_(' + item.rowNumber + ',' + idx + ')"' +
      ' class="w-full py-3.5 bg-primary text-white font-bold text-sm rounded-2xl active:scale-95 transition shadow-md shadow-primary/20">' +
      'Simpan Update & Kirim WA ke Warga' +
    '</button>';

  modal.classList.remove('hidden');
}

function closeAdminPengaduanDetail() {
  var modal = document.getElementById('adminPengaduanDetailModal');
  if (modal) modal.classList.add('hidden');
}

// Quick status change from grid buttons
function _quickSetLaporStatus_(rowNumber, status, idx) {
  // Update visual selection
  var body = document.getElementById('adminPengaduanDetailBody');
  if (body) {
    body.querySelectorAll('button[onclick*="_quickSetLaporStatus_"]').forEach(function(btn) {
      var btnStatus = btn.getAttribute('onclick').match(/'([^']+)'/)?.[1];
      var c = _LAPOR_STATUS_CFG_[btnStatus] || {};
      if (btnStatus === status) {
        btn.className = 'py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 ' + c.bg + ' ' + c.text + ' ' + c.border;
      } else {
        btn.className = 'py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 bg-gray-50 text-gray-400 border-gray-200';
      }
    });
  }
  // Store selection for save
  if (_adminLaporData_[idx]) _adminLaporData_[idx]._selectedStatus_ = status;
}

function _saveAdminLaporStatus_(rowNumber, idx) {
  var item    = _adminLaporData_[idx];
  var status  = (item && item._selectedStatus_) || item.status;
  var catatan = document.getElementById('adminLaporCatatan')?.value || '';

  var btn = document.querySelector('#adminPengaduanDetailBody button[onclick*="_saveAdminLaporStatus_"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

  gasPost_('updatePengaduanStatus', {
    rowNumber : rowNumber,
    status    : status,
    catatan   : catatan,
    adminEmail: currentUser.email
  })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan Update & Kirim WA ke Warga'; }
    if (!res.ok) { showToast('Gagal update', 'error'); return; }
    // Update local data
    if (item) { item.status = status; item.catatan = catatan; delete item._selectedStatus_; }
    // Update cache with new status so preview stays consistent
    if (_adminLaporCache_ && _adminLaporCache_.data) {
      var cached = _adminLaporCache_.data.find(function(d) { return d.rowNumber === rowNumber; });
      if (cached) { cached.status = status; cached.catatan = catatan; }
      _ssSetExplore_('exploreLaporCache', _adminLaporCache_);
    }
    closeAdminPengaduanDetail();
    showToast('Status diupdate! WA terkirim ke warga.', 'success');
    _renderAdminPengaduanList_();
    _renderAdminLaporPreview_(_adminLaporCache_); // refresh preview from updated cache
  })
  .catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan Update & Kirim WA ke Warga'; }
    showToast('Gagal update', 'error');
  });
}


/* ============================================================
   NOTIFICATION SYSTEM — PWP
   Polling-based, personal + public + admin categories
   ============================================================ */

var notifUnreadCount  = parseInt(localStorage.getItem('notif_unread') || '0', 10) || 0;
var notifLastTs       = localStorage.getItem('notif_lastTs') || '';
var notifAllItems     = (function() { try { return JSON.parse(localStorage.getItem('notif_items') || '[]') || []; } catch(e) { return []; } })();
var notifPanelOpen    = false;
var notifPollingTimer = null;

// Simpan notif ke localStorage agar tidak hilang saat refresh
function _saveNotifs_() {
  try {
    localStorage.setItem('notif_items', JSON.stringify(notifAllItems.slice(0, 50)));
    localStorage.setItem('notif_unread', String(notifUnreadCount));
  } catch(_) {}
}

// Hapus semua notif (lokal per-user) — lastTs tetap agar tidak muncul lagi
function clearAllNotifs_() {
  notifAllItems = [];
  notifUnreadCount = 0;
  try { localStorage.removeItem('notif_items'); localStorage.setItem('notif_unread', '0'); } catch(_) {}
  _updateNotifBadge_();
  _renderNotifList_();
}

// Notif icons — satu tema: rounded square bg + SVG putih, konsisten dengan app icon style
function _notifIconHtml_(subType) {
  var cfg = {
    ipl_submit  : { bg:'#3B82F6', d:'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0L8 8m4-4l4 4' },
    ipl_confirm : { bg:'#3b82f6', d:'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    ipl_reject  : { bg:'#EF4444', d:'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z' },
    pedoman     : { bg:'#8B5CF6', d:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    kas         : { bg:'#F59E0B', d:'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    info_cluster: { bg:'#6366F1', d:'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
    info_fasum  : { bg:'#3b82f6', d:'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    reminder    : { bg:'#F97316', d:'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    info        : { bg:'#94A3B8', d:'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
  };
  var c = cfg[subType] || cfg['info'];
  return '<div class="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center" style="background:' + c.bg + '">'
    + '<svg class="w-4 h-4" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="' + c.d + '"/>'
    + '</svg></div>';
}

function initNotifications() {
  if (!currentUser || !currentUser.email) return;
  var btn = document.getElementById('notifBellBtn');
  if (btn) btn.classList.remove('hidden');
  var dskBtn = document.getElementById('dskNotifBellBtn');
  if (dskBtn) dskBtn.classList.remove('hidden');
  // Tampilkan notif yang tersimpan dulu (biar tidak hilang setelah refresh)
  _renderNotifList_();
  _updateNotifBadge_();
  fetchNotifications_();
  if (notifPollingTimer) clearInterval(notifPollingTimer);
  notifPollingTimer = setInterval(fetchNotifications_, 12000); // ~realtime, poll 12 detik
  initPushNotifications();
}

/* ============================================================
   PUSH NOTIFICATIONS (OneSignal) — registrasi user + soft prompt
   ============================================================ */
function initPushNotifications() {
  if (!currentUser || !currentUser.email || typeof OneSignalDeferred === 'undefined') return;

  OneSignalDeferred.push(function(OneSignal) {
    // Kaitkan device ini dengan email user (untuk segmentasi masa depan)
    OneSignal.login(currentUser.email).catch(function() {});
    OneSignal.User.addTag('role', currentUser.role || 'warga');

    if (OneSignal.Notifications.permission) return; // sudah granted
    if (localStorage.getItem('push_prompt_seen')) return;
    setTimeout(showPushPrompt, 1500);
  });
}

function showPushPrompt() {
  var modal = document.getElementById('pushPromptModal');
  if (!modal) return;
  // Hint khusus iOS: push web hanya jalan jika app sudah ditambahkan ke Home Screen
  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var hint = document.getElementById('pushPromptIosHint');
  if (hint) hint.classList.toggle('hidden', !(isIos && !isStandalone));
  modal.classList.remove('hidden');
}

function dismissPushPrompt() {
  localStorage.setItem('push_prompt_seen', '1');
  var modal = document.getElementById('pushPromptModal');
  if (modal) modal.classList.add('hidden');
}

function enablePushNotifications() {
  localStorage.setItem('push_prompt_seen', '1');
  var modal = document.getElementById('pushPromptModal');
  if (modal) modal.classList.add('hidden');
  if (typeof OneSignalDeferred === 'undefined') return;
  OneSignalDeferred.push(function(OneSignal) {
    OneSignal.Notifications.requestPermission().catch(function() {});
  });
}

function fetchNotifications_() {
  if (!currentUser || !currentUser.email) return;
  gasGet_('getNotifications', {
    email : currentUser.email,
    lastTs: notifLastTs
  }).then(function(res) {
    if (!res || !res.success) return;
    var newItems = res.notifications || [];
    // dedup: jangan tambahkan id yang sudah ada
    if (newItems.length > 0) {
      var existing = {};
      notifAllItems.forEach(function(n) { if (n && n.id) existing[n.id] = true; });
      newItems = newItems.filter(function(n) { return !(n && n.id && existing[n.id]); });
    }
    if (newItems.length > 0) {
      notifAllItems = newItems.concat(notifAllItems).slice(0, 50);
      notifUnreadCount += newItems.length;
      _saveNotifs_();
      _updateNotifBadge_();
      _renderNotifList_();
      if (!notifPanelOpen) _playNotifBeep_();
      _showBrowserNotif_(newItems);
    }
    if (res.serverTime) {
      notifLastTs = res.serverTime;
      localStorage.setItem('notif_lastTs', notifLastTs);
    }
  }).catch(function() {});
}

function _updateNotifBadge_() {
  var badges = [
    document.getElementById('notifBadge'),
    document.getElementById('dskNotifBadge')
  ];
  badges.forEach(function(badge) {
    if (!badge) return;
    if (notifUnreadCount > 0) {
      badge.textContent = notifUnreadCount > 99 ? '99+' : String(notifUnreadCount);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  });
}

function _renderNotifList_() {
  var list = document.getElementById('notifList');
  var clearBtn = document.getElementById('notifClearBtn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !notifAllItems.length);
  if (!list) return;
  if (!notifAllItems.length) {
    list.innerHTML = '<div class="flex flex-col items-center justify-center py-12 gap-3"><svg class="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg><p class="text-sm text-gray-400">Tidak ada notifikasi</p></div>';
    return;
  }
  list.innerHTML = notifAllItems.map(function(n) {
    var d  = n.timestamp ? new Date(n.timestamp) : null;
    var ts = d ? d.toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
    return '<div class="flex items-center gap-3 px-5 py-3.5">'
      + _notifIconHtml_(n.subType)
      + '<div class="flex-1 min-w-0">'
        + '<p class="text-sm font-semibold text-gray-900 leading-snug">' + _escHtml_(n.title) + '</p>'
        + '<p class="text-xs text-gray-500 mt-0.5 leading-relaxed">' + _escHtml_(n.body) + '</p>'
        + '<p class="text-[10px] text-gray-300 mt-1">' + ts + '</p>'
      + '</div>'
    + '</div>';
  }).join('');
}

function _escHtml_(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toggleNotifPanel() {
  var panel    = document.getElementById('notifPanel');
  var backdrop = document.getElementById('notifBackdrop');
  var spacer   = document.getElementById('notifPanelSpacer');
  if (!panel) return;

  var dskTopbar = document.getElementById('desktopTopbar');
  var isDesktop = dskTopbar && getComputedStyle(dskTopbar).display !== 'none';

  notifPanelOpen = !notifPanelOpen;
  if (notifPanelOpen) fetchNotifications_();   // ambil notif terbaru saat dibuka

  // ── DESKTOP: dropdown ringkas yang menempel di kanan atas (dekat bell) ──
  if (isDesktop) {
    panel.classList.add('notif-desktop');
    // bersihkan inline style versi mobile agar styling CSS dropdown berlaku
    panel.style.transform = '';
    panel.style.left = '';
    if (notifPanelOpen) {
      panel.classList.add('open');
      panel.style.pointerEvents = 'auto';
      if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.style.top = '0px';
        backdrop.style.background = 'transparent';
        backdrop.style.zIndex = '115';
      }
      notifUnreadCount = 0;
      _updateNotifBadge_();
      _saveNotifs_();
    } else {
      panel.classList.remove('open');
      panel.style.pointerEvents = 'none';
      if (backdrop) backdrop.classList.add('hidden');
    }
    return;
  }

  // ── MOBILE: sheet melebar yang turun dari atas (perilaku lama) ──
  panel.classList.remove('notif-desktop', 'open');
  if (backdrop) { backdrop.style.background = ''; backdrop.style.zIndex = ''; }
  var header  = document.querySelector('header');
  var headerH = header ? header.getBoundingClientRect().height : 56;
  if (spacer) spacer.style.height = headerH + 'px';
  panel.style.left = '0px';

  if (notifPanelOpen) {
    panel.style.transform     = 'translateY(0)';
    panel.style.pointerEvents = 'auto';
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.style.top = headerH + 'px'; // backdrop mulai bawah header
    }
    notifUnreadCount = 0;
    _updateNotifBadge_();
    _saveNotifs_();
  } else {
    panel.style.transform     = 'translateY(-100%)';
    panel.style.pointerEvents = 'none';
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function _playNotifBeep_() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var notes = [{ freq: 1046.5, start: 0, dur: 0.12 }, { freq: 1318.5, start: 0.1, dur: 0.25 }];
    notes.forEach(function(note) {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.start);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + note.start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.start + note.dur);
      osc.start(ctx.currentTime + note.start);
      osc.stop(ctx.currentTime + note.start + note.dur);
    });
  } catch(_) {}
}

function _showBrowserNotif_(items) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') { Notification.requestPermission(); return; }
  if (Notification.permission !== 'granted') return;
  items.slice(0, 3).forEach(function(n) {
    try {
      new Notification(n.title || 'PWP', {
        body: n.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png'
      });
    } catch(_) {}
  });
}

/* ============================================================
   GREETING BANNER — slide otomatis tiap 5 detik
   ============================================================ */
var _bannerTimer_   = null;
var _bannerIdx_     = 0;

// Palet warna banner — satu tone family, cukup vivid
var _BANNER_PALETTES_ = [
  'linear-gradient(135deg,#4f46e5,#7c3aed)', // indigo → violet
  'linear-gradient(135deg,#1d4ed8,#0891b2)', // teal → cyan
  'linear-gradient(135deg,#1d4ed8,#4f46e5)', // blue → indigo
  'linear-gradient(135deg,#7c3aed,#db2777)', // violet → pink
  'linear-gradient(135deg,#1e3a8a,#1d4ed8)', // emerald → teal
  'linear-gradient(135deg,#1e40af,#1d4ed8)'  // navy → teal
];

var _bannerItems_ = [];

function startGreetingBanner_(items) {
  if (!items || !items.length) return;

  var wrap     = document.getElementById('greetingBannerWrap');
  var track    = document.getElementById('greetingBannerTrack');
  var dotsEl   = document.getElementById('greetingBannerDots');
  var viewport = document.getElementById('greetingBannerViewport');
  if (!wrap || !track) return;

  wrap.classList.remove('hidden');
  _bannerItems_ = items;
  _bannerIdx_   = 0;

  // ── Build semua slide berjajar horizontal, tiap slide warna sendiri ──
  track.innerHTML = items.map(function(item, i) {
    var grad = _BANNER_PALETTES_[i % _BANNER_PALETTES_.length];
    return '<div class="banner-slide" style="min-width:100%;box-sizing:border-box;'
      + 'padding:16px 18px 22px;background:' + grad + ';">'
      + '<p class="text-sm font-bold text-white text-center leading-snug px-3">'
      +   _escHtml_(item.judul || '') + '</p>'
      + '<p class="text-xs font-normal text-white/85 text-center leading-relaxed mt-1 px-1">'
      +   _escHtml_(item.konten || '') + '</p>'
      + '</div>';
  }).join('');

  // ── Dots ──
  if (dotsEl) {
    dotsEl.innerHTML = items.length > 1
      ? items.map(function(_, i) {
          return '<span class="banner-dot rounded-full" style="height:4px;width:'
            + (i===0?'16':'6') + 'px;background:rgba(255,255,255,'
            + (i===0?'0.9':'0.4') + ');display:inline-block;'
            + 'transition:width .3s ease, background .3s ease;"></span>';
        }).join('')
      : '';
  }

  _goToBannerSlide_(0, false);

  // ── Autoplay + drag hanya jika lebih dari 1 slide ──
  _stopBannerAutoplay_();
  if (items.length > 1) {
    _startBannerAutoplay_();
    _setupBannerDrag_(viewport, track);
  }
}

function _startBannerAutoplay_() {
  _stopBannerAutoplay_();
  if (!_bannerItems_ || _bannerItems_.length < 2) return;
  _bannerTimer_ = setInterval(function() {
    _goToBannerSlide_((_bannerIdx_ + 1) % _bannerItems_.length, true);
  }, 10000); // hold 10 detik per slide
}

function _stopBannerAutoplay_() {
  if (_bannerTimer_) { clearInterval(_bannerTimer_); _bannerTimer_ = null; }
}

function _goToBannerSlide_(idx, animate) {
  var track  = document.getElementById('greetingBannerTrack');
  var dotsEl = document.getElementById('greetingBannerDots');
  if (!track || !_bannerItems_.length) return;

  idx = Math.max(0, Math.min(idx, _bannerItems_.length - 1));
  _bannerIdx_ = idx;

  track.style.transition = animate
    ? 'transform .45s cubic-bezier(0.22,1,0.36,1)'
    : 'none';
  track.style.transform = 'translateX(-' + (idx * 100) + '%)';

  if (dotsEl) {
    dotsEl.querySelectorAll('.banner-dot').forEach(function(dot, i) {
      dot.style.width      = i === idx ? '16px' : '6px';
      dot.style.background = i === idx ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
    });
  }
}

function _setupBannerDrag_(viewport, track) {
  if (!viewport || viewport.dataset.dragBound) return;
  viewport.dataset.dragBound = '1';

  var startX = 0, dragging = false, width = 0, moved = 0;

  function getX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

  function onDown(e) {
    dragging = true;
    moved    = 0;
    startX   = getX(e);
    width    = viewport.getBoundingClientRect().width || 1;
    track.style.transition = 'none';
    viewport.style.cursor  = 'grabbing';
    _stopBannerAutoplay_(); // pause selama ditahan
  }
  function onMove(e) {
    if (!dragging) return;
    moved = getX(e) - startX;
    // resistance saat menyeret melewati ujung
    var atStart = _bannerIdx_ === 0 && moved > 0;
    var atEnd   = _bannerIdx_ === _bannerItems_.length - 1 && moved < 0;
    var delta   = (atStart || atEnd) ? moved * 0.35 : moved;
    var basePx  = -_bannerIdx_ * width;
    track.style.transform = 'translateX(' + (basePx + delta) + 'px)';
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    viewport.style.cursor = 'grab';
    var threshold = width * 0.18;
    if (moved <= -threshold && _bannerIdx_ < _bannerItems_.length - 1) {
      _goToBannerSlide_(_bannerIdx_ + 1, true);
    } else if (moved >= threshold && _bannerIdx_ > 0) {
      _goToBannerSlide_(_bannerIdx_ - 1, true);
    } else {
      _goToBannerSlide_(_bannerIdx_, true); // snap balik
    }
    _startBannerAutoplay_(); // lanjut lagi
  }

  // Mouse (desktop)
  viewport.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  // Touch (mobile)
  viewport.addEventListener('touchstart', onDown, { passive: true });
  viewport.addEventListener('touchmove',  onMove, { passive: true });
  viewport.addEventListener('touchend',   onUp);
  // Pause saat hover di desktop
  viewport.addEventListener('mouseenter', _stopBannerAutoplay_);
  viewport.addEventListener('mouseleave', function() { if (!dragging) _startBannerAutoplay_(); });
}

/* ============================================================
   DARK MODE TOGGLE
   ============================================================ */
(function() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
    _applyDarkModeIcons_(true);
  }
})();

function toggleDarkMode() {
  var isDark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  _applyDarkModeIcons_(isDark);
}

function _applyDarkModeIcons_(isDark) {
  ['iconSun', 'dskIconSun'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !isDark);
  });
  ['iconMoon', 'dskIconMoon'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', isDark);
  });
}

function _showDarkModeBtn_() {
  var btn = document.getElementById('darkModeBtn');
  if (btn) btn.classList.remove('hidden');
  var dskBtn = document.getElementById('dskDarkModeBtn');
  if (dskBtn) dskBtn.classList.remove('hidden');
}

/* ============================================================
   LOMBA 17 AGUSTUS — Event registration (warga + admin)
   ============================================================ */
var _lomba17Cache = null;
var _lomba17PollTimer = null;
var _lomba17AdminPollTimer = null;
var _lomba17PesertaPollTimer = null;
var _lomba17SelectedEventId = null;
var _lomba17PesertaSelectedId = null;
var _lomba17PesertaCache = {};
var _lomba17EventFormStatus = 'Buka';
var LOMBA17_KATEGORI_FALLBACK = ['Balita (0-5 th)', 'Anak (6-12 th)', 'Remaja (13-17 th)', 'Dewasa (18-59 th)', 'Lansia (60+ th)'];

function _fmtLomba17Tanggal_(tgl) {
  if (!tgl) return '';
  var parts = String(tgl).split('-');
  if (parts.length !== 3) return tgl;
  var months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var mi = parseInt(parts[1], 10) - 1;
  return parseInt(parts[2], 10) + ' ' + (months[mi] || '') + ' ' + parts[0];
}

/* ---------- WARGA: list lomba & daftar ---------- */
function openLomba17Modal() {
  var m = document.getElementById('lomba17Modal');
  if (!m) return;
  m.classList.remove('hidden');
  if (_lomba17Cache && _lomba17Cache.data) {
    _renderLomba17List_(_lomba17Cache.data);
  } else {
    var list = document.getElementById('lomba17List');
    if (list) {
      list.innerHTML = '<div class="flex flex-col items-center justify-center gap-2 py-10 text-gray-400">' +
        '<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>' +
        '<p class="text-xs">Memuat daftar lomba...</p>' +
        '</div>';
    }
  }
  _loadLomba17List_();
  if (_lomba17PollTimer) clearInterval(_lomba17PollTimer);
  _lomba17PollTimer = setInterval(_loadLomba17List_, 15000);
}
function closeLomba17Modal() {
  var m = document.getElementById('lomba17Modal');
  if (m) m.classList.add('hidden');
  if (_lomba17PollTimer) { clearInterval(_lomba17PollTimer); _lomba17PollTimer = null; }
}
function _loadLomba17List_() {
  var list = document.getElementById('lomba17List');
  if (!list) return;
  var email = (currentUser && currentUser.email) || '';
  gasGet_('getLomba17Events', { email: email }).then(function(res) {
    if (!res || !res.ok) {
      list.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">Gagal memuat data lomba</p>';
      return;
    }
    _lomba17Cache = res;
    _renderLomba17List_(res.data || []);
  }).catch(function() {});
}
var _LOMBA17_ICON_PIN_ = '<svg class="w-3 h-3 inline -mt-px mr-1 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
var _LOMBA17_ICON_USERS_ = '<svg class="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
var _LOMBA17_ICON_CHECK_ = '<svg class="w-3 h-3 inline -mt-px mr-1" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
var _LOMBA17_ICON_CLOCK_ = '<svg class="w-3 h-3 inline -mt-px mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2"/></svg>';
var _LOMBA17_ICON_TROPHY_ = '<svg class="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M5 4h14v6a7 7 0 0 1-14 0V4z"/><path d="M5 6H3a2 2 0 0 0 0 4h2M19 6h2a2 2 0 0 1 0 4h-2"/></svg>';

function _renderLomba17List_(events) {
  var list = document.getElementById('lomba17List');
  if (!list) return;
  if (!events.length) {
    list.innerHTML = '<div class="flex flex-col items-center justify-center gap-2 py-10 text-center">' + _LOMBA17_ICON_TROPHY_ + '<p class="text-xs text-gray-400">Belum ada lomba yang diumumkan.<br>Pantau terus ya!</p></div>';
    return;
  }
  list.innerHTML = '';
  events.forEach(function(ev) {
    var isOpen = String(ev.status).toLowerCase() === 'buka';
    var kategoriHtml = (ev.kategori || []).map(function(k) {
      return '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">' + _escapeHtml_(k) + '</span>';
    }).join(' ');
    var myBadge = ev.myCount > 0
      ? '<div class="mt-2"><span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">' + _LOMBA17_ICON_CHECK_ + ev.myCount + ' peserta terdaftar dari rumah Anda</span></div>'
      : '';

    var card = document.createElement('div');
    card.className = 'rounded-2xl border border-gray-100 p-4';
    card.innerHTML =
      '<div class="flex items-start justify-between gap-2">' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold text-gray-900">' + _escapeHtml_(ev.nama) + '</p>' +
          '<p class="text-xs text-gray-400 mt-0.5">' + _fmtLomba17Tanggal_(ev.tanggal) + (ev.jam ? ' · ' + _escapeHtml_(ev.jam) : '') + '</p>' +
          (ev.lokasi ? '<p class="text-xs text-gray-400 mt-0.5">' + _LOMBA17_ICON_PIN_ + _escapeHtml_(ev.lokasi) + '</p>' : '') +
        '</div>' +
        '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ' + (isOpen ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500') + '">' + (isOpen ? 'Buka' : 'Ditutup') + '</span>' +
      '</div>' +
      (ev.deskripsi ? '<p class="text-xs text-gray-500 mt-2">' + _escapeHtml_(ev.deskripsi) + '</p>' : '') +
      '<div class="flex flex-wrap gap-1.5 mt-2">' + kategoriHtml + '</div>' +
      '<div class="flex items-center justify-between mt-3"><span class="text-xs text-gray-500 font-medium flex items-center">' + _LOMBA17_ICON_USERS_ + ev.jumlahPendaftar + ' peserta sudah daftar</span></div>' +
      myBadge;

    var btn = document.createElement('button');
    btn.className = isOpen
      ? 'w-full bg-primary text-white py-2.5 rounded-xl font-semibold text-xs active:scale-95 transition mt-3'
      : 'w-full bg-gray-100 text-gray-400 py-2.5 rounded-xl font-semibold text-xs cursor-not-allowed mt-3';
    btn.innerText = isOpen ? 'Daftar Sekarang' : 'Pendaftaran Ditutup';
    btn.disabled = !isOpen;
    if (isOpen) btn.onclick = function() { openLomba17RegisterModal(ev.id); };
    card.appendChild(btn);

    list.appendChild(card);
  });
}

function openLomba17RegisterModal(lombaId) {
  _lomba17SelectedEventId = lombaId;
  var ev = ((_lomba17Cache && _lomba17Cache.data) || []).find(function(e) { return e.id === lombaId; });
  if (!ev) return;

  document.getElementById('lomba17RegisterEventName').innerText = ev.nama;

  var myBlok = (currentUser && currentUser.blocks && currentUser.blocks[0]) || (currentUser && currentUser.blok) || '-';
  document.getElementById('lomba17FormBlokValue').innerText = myBlok;

  var sel = document.getElementById('lomba17FormKategori');
  sel.innerHTML = '';
  var opts = (ev.kategori && ev.kategori.length) ? ev.kategori : ((_lomba17Cache && _lomba17Cache.kategoriOptions) || LOMBA17_KATEGORI_FALLBACK);
  opts.forEach(function(k) {
    var opt = document.createElement('option');
    opt.value = k; opt.textContent = k;
    sel.appendChild(opt);
  });

  document.getElementById('lomba17FormNama').value = '';
  document.getElementById('lomba17FormUsia').value = '';
  document.getElementById('lomba17FormWa').value = '';
  document.getElementById('lomba17FormError').classList.add('hidden');

  var m = document.getElementById('lomba17RegisterModal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}
function closeLomba17RegisterModal() {
  var m = document.getElementById('lomba17RegisterModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}
function submitLomba17Register() {
  var errEl = document.getElementById('lomba17FormError');
  errEl.classList.add('hidden');

  var nama = document.getElementById('lomba17FormNama').value.trim();
  var kategori = document.getElementById('lomba17FormKategori').value;
  var usia = document.getElementById('lomba17FormUsia').value.trim();
  var wa = document.getElementById('lomba17FormWa').value.trim();

  if (!nama) { errEl.textContent = 'Nama peserta wajib diisi.'; errEl.classList.remove('hidden'); return; }
  if (!kategori) { errEl.textContent = 'Pilih kategori.'; errEl.classList.remove('hidden'); return; }
  if (!currentUser || !currentUser.email) { errEl.textContent = 'Silakan login terlebih dahulu.'; errEl.classList.remove('hidden'); return; }

  var blok = (currentUser.blocks && currentUser.blocks[0]) || currentUser.blok || '';

  var btn = document.getElementById('lomba17FormSubmitBtn');
  var txt = document.getElementById('lomba17FormBtnText');
  var spin = document.getElementById('lomba17FormSpinner');
  btn.disabled = true; txt.textContent = 'Mengirim...'; spin.classList.remove('hidden');

  gasPost_('registerLomba17', { payload: {
    lombaId: _lomba17SelectedEventId,
    namaPeserta: nama,
    kategori: kategori,
    usia: usia,
    blok: blok,
    noHp: wa,
    email: currentUser.email
  }}).then(function(res) {
    btn.disabled = false; txt.textContent = 'Daftar Sekarang'; spin.classList.add('hidden');
    if (!res || !res.ok) {
      errEl.textContent = (res && res.message) || 'Gagal mendaftar, coba lagi.';
      errEl.classList.remove('hidden');
      return;
    }
    showToast('Pendaftaran berhasil!', 'success');
    closeLomba17RegisterModal();
    _loadLomba17List_();
  }).catch(function() {
    btn.disabled = false; txt.textContent = 'Daftar Sekarang'; spin.classList.add('hidden');
    errEl.textContent = 'Gagal mendaftar, coba lagi.';
    errEl.classList.remove('hidden');
  });
}

/* ---------- ADMIN: kelola lomba ---------- */
function loadAdminLomba17Preview() {
  var el = document.getElementById('adminLomba17PreviewList');
  if (!el) return;
  gasGet_('getLomba17Events', {}).then(function(res) {
    if (!res || !res.ok || !res.data || !res.data.length) {
      el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada lomba dibuat</p>';
      return;
    }
    var total = res.data.length;
    var totalPendaftar = res.data.reduce(function(s, e) { return s + (e.jumlahPendaftar || 0); }, 0);
    var totalBuka = res.data.filter(function(e) { return String(e.status).toLowerCase() === 'buka'; }).length;
    el.innerHTML = '<p class="text-xs text-gray-500 font-medium">' + total + ' lomba (' + totalBuka + ' buka) · ' + totalPendaftar + ' total pendaftar</p>';
  }).catch(function() {});
}

function openLomba17AdminModal() {
  var m = document.getElementById('lomba17AdminModal');
  if (!m) return;
  m.classList.remove('hidden');
  if (_lomba17Cache && _lomba17Cache.data) {
    _renderLomba17AdminList_(_lomba17Cache.data);
  } else {
    var list = document.getElementById('lomba17AdminList');
    if (list) {
      list.innerHTML = '<div class="flex flex-col items-center justify-center gap-2 py-10 text-gray-400">' +
        '<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>' +
        '<p class="text-xs">Memuat data lomba...</p>' +
        '</div>';
    }
  }
  _loadLomba17AdminList_();
  if (_lomba17AdminPollTimer) clearInterval(_lomba17AdminPollTimer);
  _lomba17AdminPollTimer = setInterval(_loadLomba17AdminList_, 15000);
}
function closeLomba17AdminModal() {
  var m = document.getElementById('lomba17AdminModal');
  if (m) m.classList.add('hidden');
  if (_lomba17AdminPollTimer) { clearInterval(_lomba17AdminPollTimer); _lomba17AdminPollTimer = null; }
}
function _loadLomba17AdminList_() {
  var list = document.getElementById('lomba17AdminList');
  if (!list) return;
  gasGet_('getLomba17Events', {}).then(function(res) {
    if (!res || !res.ok) {
      list.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">Gagal memuat data</p>';
      return;
    }
    _lomba17Cache = res;
    loadAdminLomba17Preview();
    _renderLomba17AdminList_(res.data || []);
  }).catch(function() {});
}
function _renderLomba17AdminList_(events) {
  var list = document.getElementById('lomba17AdminList');
  if (!list) return;
  if (!events.length) {
    list.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">Belum ada lomba. Klik "Buat Lomba Baru" untuk mulai.</p>';
    return;
  }
  list.innerHTML = '';
  events.forEach(function(ev) {
    var isOpen = String(ev.status).toLowerCase() === 'buka';
    var kategoriHtml = (ev.kategori || []).map(function(k) {
      return '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">' + _escapeHtml_(k) + '</span>';
    }).join(' ');

    var card = document.createElement('div');
    card.className = 'rounded-2xl border border-gray-100 p-4';
    card.innerHTML =
      '<div class="flex items-start justify-between gap-2">' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold text-gray-900">' + _escapeHtml_(ev.nama) + '</p>' +
          '<p class="text-xs text-gray-400 mt-0.5">' + _fmtLomba17Tanggal_(ev.tanggal) + (ev.jam ? ' · ' + _escapeHtml_(ev.jam) : '') + '</p>' +
          (ev.lokasi ? '<p class="text-xs text-gray-400 mt-0.5">' + _LOMBA17_ICON_PIN_ + _escapeHtml_(ev.lokasi) + '</p>' : '') +
          (ev.tutupTanggal ? '<p class="text-xs text-amber-500 mt-0.5">' + _LOMBA17_ICON_CLOCK_ + 'Tutup otomatis ' + _fmtLomba17Tanggal_(ev.tutupTanggal) + (ev.tutupJam ? ' · ' + _escapeHtml_(ev.tutupJam) : '') + '</p>' : '') +
        '</div>' +
        '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ' + (isOpen ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500') + '">' + (isOpen ? 'Buka' : 'Ditutup') + '</span>' +
      '</div>' +
      '<div class="flex flex-wrap gap-1.5 mt-2">' + kategoriHtml + '</div>';

    var pesertaBtn = document.createElement('button');
    pesertaBtn.className = 'mt-3 w-full bg-gray-50 text-gray-700 py-2 rounded-xl font-semibold text-xs active:scale-95 transition flex items-center justify-center gap-1.5';
    pesertaBtn.innerHTML = _LOMBA17_ICON_USERS_ + ev.jumlahPendaftar + ' peserta — lihat detail';
    pesertaBtn.onclick = function() { openLomba17PesertaModal(ev.id, ev.nama); };
    card.appendChild(pesertaBtn);

    var actionRow = document.createElement('div');
    actionRow.className = 'flex gap-2 mt-2';

    var editBtn = document.createElement('button');
    editBtn.className = 'flex-1 bg-indigo-50 text-indigo-600 py-2 rounded-xl font-semibold text-xs active:scale-95 transition';
    editBtn.innerText = 'Edit';
    editBtn.onclick = function() { openLomba17EventForm(ev.id); };

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'flex-1 py-2 rounded-xl font-semibold text-xs active:scale-95 transition ' + (isOpen ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600');
    toggleBtn.innerText = isOpen ? 'Tutup Daftar' : 'Buka Daftar';
    toggleBtn.onclick = function() { toggleLomba17EventStatus(ev.id, isOpen ? 'Tutup' : 'Buka'); };

    var delBtn = document.createElement('button');
    delBtn.className = 'flex-1 bg-red-50 text-red-600 py-2 rounded-xl font-semibold text-xs active:scale-95 transition';
    delBtn.innerText = 'Hapus';
    delBtn.onclick = function() { deleteLomba17Event(ev.id); };

    actionRow.appendChild(editBtn);
    actionRow.appendChild(toggleBtn);
    actionRow.appendChild(delBtn);
    card.appendChild(actionRow);

    list.appendChild(card);
  });
}

function toggleLomba17EventStatus(id, newStatus) {
  gasPost_('updateLomba17Event', { payload: { adminEmail: currentUser.email, id: id, status: newStatus } })
    .then(function(res) {
      if (!res || !res.ok) { showToast((res && res.message) || 'Gagal update status', 'error'); return; }
      showToast('Status pendaftaran diperbarui', 'success');
      _loadLomba17AdminList_();
    }).catch(function() { showToast('Gagal update status', 'error'); });
}

function deleteLomba17Event(id) {
  if (!confirm('Hapus lomba ini? Data pendaftar yang sudah ada tetap tersimpan di sheet.')) return;
  gasPost_('deleteLomba17Event', { payload: { adminEmail: currentUser.email, id: id } })
    .then(function(res) {
      if (!res || !res.ok) { showToast((res && res.message) || 'Gagal menghapus', 'error'); return; }
      showToast('Lomba dihapus', 'success');
      _loadLomba17AdminList_();
    }).catch(function() { showToast('Gagal menghapus', 'error'); });
}

/* ---------- ADMIN: form buat/edit lomba ---------- */
function openLomba17EventForm(id) {
  var titleEl = document.getElementById('lomba17EventFormTitle');
  document.getElementById('lomba17EventFormId').value = id || '';
  document.getElementById('lomba17EventFormError').classList.add('hidden');

  var kategoriOptions = (_lomba17Cache && _lomba17Cache.kategoriOptions) || LOMBA17_KATEGORI_FALLBACK;
  var kategoriContainer = document.getElementById('lomba17EventFormKategori');
  kategoriContainer.innerHTML = '';

  var ev = id ? ((_lomba17Cache && _lomba17Cache.data) || []).find(function(e) { return e.id === id; }) : null;

  var chipCheckSvg = '<svg class="w-3 h-3 inline -mt-px mr-1" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
  kategoriOptions.forEach(function(k) {
    var checked = !!(ev && ev.kategori.indexOf(k) !== -1);
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.value = k;
    chip.dataset.selected = checked ? '1' : '0';
    var setStyle = function(sel) {
      chip.className = 'text-[11px] font-semibold px-3 py-1.5 rounded-full border transition flex items-center ' +
        (sel ? 'bg-red-500 text-white border-red-500 shadow-sm' : 'bg-white text-gray-500 border-gray-200');
      chip.innerHTML = (sel ? chipCheckSvg : '') + k;
    };
    setStyle(checked);
    chip.onclick = function() {
      var sel = chip.dataset.selected === '1';
      chip.dataset.selected = sel ? '0' : '1';
      setStyle(!sel);
    };
    kategoriContainer.appendChild(chip);
  });

  if (ev) {
    titleEl.innerText = 'Edit Lomba';
    document.getElementById('lomba17EventFormNama').value = ev.nama || '';
    document.getElementById('lomba17EventFormTanggal').value = ev.tanggal || '';
    document.getElementById('lomba17EventFormJam').value = ev.jam || '';
    document.getElementById('lomba17EventFormLokasi').value = ev.lokasi || '';
    document.getElementById('lomba17EventFormDeskripsi').value = ev.deskripsi || '';
    document.getElementById('lomba17EventFormTutupTanggal').value = ev.tutupTanggal || '';
    document.getElementById('lomba17EventFormTutupJam').value = ev.tutupJam || '';
    setLomba17EventFormStatus(String(ev.status).toLowerCase() === 'tutup' ? 'Tutup' : 'Buka');
  } else {
    titleEl.innerText = 'Buat Lomba';
    document.getElementById('lomba17EventFormNama').value = '';
    document.getElementById('lomba17EventFormTanggal').value = '';
    document.getElementById('lomba17EventFormJam').value = '';
    document.getElementById('lomba17EventFormLokasi').value = '';
    document.getElementById('lomba17EventFormDeskripsi').value = '';
    document.getElementById('lomba17EventFormTutupTanggal').value = '';
    document.getElementById('lomba17EventFormTutupJam').value = '';
    setLomba17EventFormStatus('Buka');
  }

  var m = document.getElementById('lomba17EventFormModal');
  m.classList.remove('hidden');
}
function closeLomba17EventForm() {
  var m = document.getElementById('lomba17EventFormModal');
  m.classList.add('hidden');
}
function setLomba17EventFormStatus(status) {
  _lomba17EventFormStatus = status;
  var bukaBtn = document.getElementById('lomba17EventFormStatusBuka');
  var tutupBtn = document.getElementById('lomba17EventFormStatusTutup');
  bukaBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition ' +
    (status === 'Buka' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-200');
  tutupBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition ' +
    (status === 'Tutup' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200');
}
function submitLomba17EventForm() {
  var errEl = document.getElementById('lomba17EventFormError');
  errEl.classList.add('hidden');

  var id = document.getElementById('lomba17EventFormId').value;
  var nama = document.getElementById('lomba17EventFormNama').value.trim();
  var tanggal = document.getElementById('lomba17EventFormTanggal').value;
  var jam = document.getElementById('lomba17EventFormJam').value.trim();
  var lokasi = document.getElementById('lomba17EventFormLokasi').value.trim();
  var deskripsi = document.getElementById('lomba17EventFormDeskripsi').value.trim();
  var tutupTanggal = document.getElementById('lomba17EventFormTutupTanggal').value;
  var tutupJam = document.getElementById('lomba17EventFormTutupJam').value;
  var kategori = Array.prototype.map.call(
    document.querySelectorAll('#lomba17EventFormKategori button[data-selected="1"]'),
    function(b) { return b.dataset.value; }
  );

  if (!nama) { errEl.textContent = 'Nama lomba wajib diisi.'; errEl.classList.remove('hidden'); return; }
  if (!kategori.length) { errEl.textContent = 'Pilih minimal 1 kategori.'; errEl.classList.remove('hidden'); return; }
  if (!tanggal) { errEl.textContent = 'Tanggal wajib diisi.'; errEl.classList.remove('hidden'); return; }
  if (tutupTanggal && !tutupJam) tutupJam = '23:59';

  var btn = document.getElementById('lomba17EventFormSubmitBtn');
  var txt = document.getElementById('lomba17EventFormBtnText');
  var spin = document.getElementById('lomba17EventFormSpinner');
  btn.disabled = true; txt.textContent = 'Menyimpan...'; spin.classList.remove('hidden');

  var payload = {
    adminEmail: currentUser.email,
    nama: nama, kategori: kategori, tanggal: tanggal,
    jam: jam, lokasi: lokasi, deskripsi: deskripsi,
    status: _lomba17EventFormStatus,
    tutupTanggal: tutupTanggal, tutupJam: tutupJam
  };
  var action = 'createLomba17Event';
  if (id) { payload.id = id; action = 'updateLomba17Event'; }

  gasPost_(action, { payload: payload }).then(function(res) {
    btn.disabled = false; txt.textContent = 'Simpan'; spin.classList.add('hidden');
    if (!res || !res.ok) {
      errEl.textContent = (res && res.message) || 'Gagal menyimpan, coba lagi.';
      errEl.classList.remove('hidden');
      return;
    }
    showToast(id ? 'Lomba diperbarui' : 'Lomba dibuat', 'success');
    closeLomba17EventForm();
    _loadLomba17AdminList_();
  }).catch(function() {
    btn.disabled = false; txt.textContent = 'Simpan'; spin.classList.add('hidden');
    errEl.textContent = 'Gagal menyimpan, coba lagi.';
    errEl.classList.remove('hidden');
  });
}

/* ---------- ADMIN: lihat peserta per lomba ---------- */
function openLomba17PesertaModal(lombaId, namaLomba) {
  _lomba17PesertaSelectedId = lombaId;
  document.getElementById('lomba17PesertaTitle').innerText = 'Peserta — ' + namaLomba;

  var cached = _lomba17PesertaCache[lombaId];
  if (cached) {
    _renderLomba17PesertaList_(cached);
  } else {
    document.getElementById('lomba17PesertaCount').innerText = 'Memuat...';
    document.getElementById('lomba17PesertaList').innerHTML = '';
  }

  var m = document.getElementById('lomba17PesertaModal');
  m.classList.remove('hidden');
  _loadLomba17Peserta_();
  if (_lomba17PesertaPollTimer) clearInterval(_lomba17PesertaPollTimer);
  _lomba17PesertaPollTimer = setInterval(_loadLomba17Peserta_, 10000);
}
function closeLomba17PesertaModal() {
  var m = document.getElementById('lomba17PesertaModal');
  m.classList.add('hidden');
  if (_lomba17PesertaPollTimer) { clearInterval(_lomba17PesertaPollTimer); _lomba17PesertaPollTimer = null; }
}
function _loadLomba17Peserta_() {
  if (!_lomba17PesertaSelectedId || !currentUser || !currentUser.email) return;
  var lombaId = _lomba17PesertaSelectedId;
  gasGet_('getLomba17Pendaftar', { adminEmail: currentUser.email, lombaId: lombaId })
    .then(function(res) {
      if (!res || !res.ok) {
        if (!_lomba17PesertaCache[lombaId]) document.getElementById('lomba17PesertaCount').innerText = 'Gagal memuat data';
        return;
      }
      _lomba17PesertaCache[lombaId] = res.data || [];
      if (_lomba17PesertaSelectedId === lombaId) _renderLomba17PesertaList_(res.data || []);
    }).catch(function() {});
}
function _renderLomba17PesertaList_(data) {
  document.getElementById('lomba17PesertaCount').innerText = data.length + ' peserta terdaftar';
  var list = document.getElementById('lomba17PesertaList');
  if (!data.length) {
    list.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">Belum ada pendaftar.</p>';
    return;
  }
  list.innerHTML = '';
  data.forEach(function(p, idx) {
    var waNum = String(p.noHp || '').replace(/\D/g, '');
    if (waNum.indexOf('0') === 0) waNum = '62' + waNum.slice(1);
    var row = document.createElement('div');
    row.className = 'flex items-center gap-3 p-3 rounded-xl bg-gray-50';
    row.innerHTML =
      '<div class="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">' + (idx + 1) + '</div>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-semibold text-gray-900 truncate">' + _escapeHtml_(p.namaPeserta) + '</p>' +
        '<p class="text-xs text-gray-400 truncate">' + _escapeHtml_(p.kategori) + (p.usia ? ' · ' + _escapeHtml_(p.usia) + ' th' : '') + ' · Blok ' + _escapeHtml_(p.blok) + '</p>' +
      '</div>' +
      (waNum ? '<a href="https://wa.me/' + waNum + '" target="_blank" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.6 6.32A8.86 8.86 0 0 0 12.05 4a8.94 8.94 0 0 0-7.7 13.45L3 21l3.66-1.31a8.85 8.85 0 0 0 5.39 1.83h.01a8.94 8.94 0 0 0 8.94-8.94 8.85 8.85 0 0 0-3.4-6.26zM12.06 19.9h-.01a7.4 7.4 0 0 1-3.78-1.04l-.27-.16-2.81 1 1-2.74-.18-.28A7.43 7.43 0 0 1 12.06 4.56a7.39 7.39 0 0 1 5.24 12.61 7.36 7.36 0 0 1-5.24 2.73zm4.06-5.55c-.22-.11-1.31-.65-1.52-.72-.2-.08-.35-.11-.49.11-.15.22-.56.72-.69.86-.13.15-.25.16-.47.06-1.27-.64-2.1-1.14-2.95-2.59-.22-.39.22-.36.63-1.2.07-.15.04-.27-.03-.39-.07-.11-.32-.78-.45-1.05-.12-.27-.25-.23-.35-.23-.09 0-.2-.01-.31-.01-.11 0-.28.04-.43.2-.15.16-.58.57-.58 1.39 0 .82.6 1.61.69 1.72.08.11 1.16 1.78 2.84 2.5 1.93.83 1.93.56 2.27.53.35-.04 1.31-.53 1.49-1.05.19-.51.19-.95.13-1.05-.05-.09-.19-.14-.41-.25z"/></svg></a>' : '');
    list.appendChild(row);
  });
}
// Export daftar peserta lomba ke PDF (print preview)
function exportLomba17PesertaPdf() {
  var lombaId = _lomba17PesertaSelectedId;
  if (!lombaId) { showToast('Pilih lomba terlebih dahulu', 'error'); return; }
  var data = _lomba17PesertaCache[lombaId] || [];
  var ev = ((_lomba17Cache && _lomba17Cache.data) || []).find(function(e) { return e.id === lombaId; }) || {};
  var namaLomba = ev.nama || (document.getElementById('lomba17PesertaTitle').innerText || '').replace(/^Peserta\s*—\s*/, '');

  var rows = data.map(function(p, idx) {
    var waNum = String(p.noHp || '').replace(/\D/g, '');
    if (waNum.indexOf('0') === 0) waNum = '62' + waNum.slice(1);
    return '<tr><td style="text-align:center">' + (idx + 1) + '</td>' +
      '<td>' + _escHtml_(p.namaPeserta || '') + '</td>' +
      '<td>' + _escHtml_(p.kategori || '') + '</td>' +
      '<td style="text-align:center">' + _escHtml_(String(p.usia || '-')) + '</td>' +
      '<td style="text-align:center">' + _escHtml_(p.blok || '-') + '</td>' +
      '<td>' + _escHtml_(waNum || p.noHp || '-') + '</td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#999">Belum ada pendaftar</td></tr>';

  var infoBits = [];
  if (ev.tanggal) infoBits.push(_kasFmtTgl_(ev.tanggal));
  if (ev.jam) infoBits.push('Jam ' + ev.jam);
  if (ev.lokasi) infoBits.push(ev.lokasi);

  var now = new Date();
  var generatedAt = ('0' + now.getDate()).slice(-2) + '/' + ('0' + (now.getMonth() + 1)).slice(-2) + '/' + now.getFullYear() + ' ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  var printedBy = (currentUser && (currentUser.fullName || currentUser.email)) || '-';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daftar Peserta - ' + _escHtml_(namaLomba) + '</title>' +
    '<style>*{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}body{padding:24px;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:18px;margin:0}' +
    '.sub{color:#666;font-size:12px;margin:2px 0 16px}.cards{display:flex;gap:10px;margin-bottom:16px}' +
    '.card{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:10px;text-align:center}.card .l{font-size:10px;color:#888;text-transform:uppercase}.card .v{font-size:15px;font-weight:800;margin-top:4px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th,td{padding:6px 8px;border-bottom:1px solid #eee}th{text-align:left;color:#666;font-size:10px;text-transform:uppercase;background:#fafafa}' +
    '.foot{font-size:10px;color:#999;margin-top:14px}</style></head>' +
    '<body style="background:#fff">' +
    '<h1>Daftar Peserta Lomba 17 Agustus</h1>' +
    '<div class="sub">' + _escHtml_(namaLomba) + (infoBits.length ? (' · ' + _escHtml_(infoBits.join(' · '))) : '') + '</div>' +
    '<div class="cards"><div class="card"><div class="l">Total Peserta</div><div class="v">' + data.length + '</div></div></div>' +
    '<table><thead><tr><th style="text-align:center">No</th><th>Nama Peserta</th><th>Kategori</th><th style="text-align:center">Usia</th><th style="text-align:center">Blok</th><th>No. WhatsApp</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="foot">Dicetak oleh: <b>' + _escHtml_(printedBy) + '</b> · ' + generatedAt + '<br>Laporan otomatis dari PWP.</div>' +
    '</body></html>';
  _kasShowPdfPreview_(html);
}

// ===== JADWAL JAGA (Piket Warga + Roster Security) =====

var _jagaCurrentWeekStart_ = null; // Date (Senin) — null = belum di-set
var _jagaSelectedDate_ = null; // 'yyyy-MM-dd' — tanggal yang dipilih di date strip
var _jagaCache_ = {}; // key: 'yyyy-MM-dd_yyyy-MM-dd' -> data
var _jagaShiftConfig_ = null; // [{name,start,end}] — cache getJagaShiftConfig

function _jagaLoadShiftConfig_() {
  if (_jagaShiftConfig_) return Promise.resolve(_jagaShiftConfig_);
  return gasGet_('getJagaShiftConfig').then(function(res) {
    _jagaShiftConfig_ = (res && res.ok && res.shifts && res.shifts.length) ? res.shifts : [
      { name: 'Pagi', start: '06:00', end: '14:00' },
      { name: 'Siang', start: '14:00', end: '22:00' },
      { name: 'Malam', start: '22:00', end: '06:00' }
    ];
    return _jagaShiftConfig_;
  }).catch(function() {
    _jagaShiftConfig_ = [
      { name: 'Pagi', start: '06:00', end: '14:00' },
      { name: 'Siang', start: '14:00', end: '22:00' },
      { name: 'Malam', start: '22:00', end: '06:00' }
    ];
    return _jagaShiftConfig_;
  });
}

function _jagaFmtDate_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function _jagaGetMonday_(d) {
  var date = new Date(d);
  var day = date.getDay(); // 0 = Minggu
  var diff = (day === 0) ? -6 : (1 - day);
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function _jagaWaBtnHtml_(noHp) {
  var hp = String(noHp || '').replace(/\D/g, '');
  if (!hp) return '';
  var waHp = hp.indexOf('0') === 0 ? '62' + hp.slice(1) : hp;
  return '<a href="https://wa.me/' + waHp + '" target="_blank" class="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center active:scale-95 transition shadow-sm">' +
    '<svg class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">' +
      '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
    '</svg>' +
  '</a>';
}

function _jagaInitial_(nama) {
  var n = String(nama || '').trim();
  return n ? n.charAt(0).toUpperCase() : '?';
}

function _jagaShiftTimeLabel_(shiftName) {
  if (!_jagaShiftConfig_) return '';
  for (var i = 0; i < _jagaShiftConfig_.length; i++) {
    if (_jagaShiftConfig_[i].name === shiftName) {
      return _jagaShiftConfig_[i].start + '–' + _jagaShiftConfig_[i].end;
    }
  }
  return '';
}

function _jagaPersonRowHtml_(nama, subtitle, noHp, avatarBg, avatarFg) {
  // Flat & minimalis: tanpa kartu abu, avatar kecil, baris rapat
  return '<div class="flex items-center gap-2.5 py-1.5">' +
    '<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style="background:' + avatarBg + ';color:' + avatarFg + ';">' + _escHtml_(_jagaInitial_(nama)) + '</div>' +
    '<div class="flex-1 min-w-0">' +
      '<p class="text-sm font-medium text-gray-800 truncate leading-tight">' + _escHtml_(nama || '') + '</p>' +
      (subtitle ? '<p class="text-[11px] text-gray-400 truncate leading-tight mt-0.5">' + _escHtml_(subtitle) + '</p>' : '') +
    '</div>' +
    _jagaWaBtnHtml_(noHp) +
  '</div>';
}

function _jagaGetCurrentShiftName_(shiftConfig) {
  if (!shiftConfig || !shiftConfig.length) return null;
  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();
  function toMin(hhmm) {
    var parts = String(hhmm || '').split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }
  for (var i = 0; i < shiftConfig.length; i++) {
    var s = shiftConfig[i];
    var start = toMin(s.start);
    var end = toMin(s.end);
    if (start === end) continue;
    if (start < end) {
      if (nowMin >= start && nowMin < end) return s.name;
    } else {
      // overnight shift, e.g. 22:00-06:00
      if (nowMin >= start || nowMin < end) return s.name;
    }
  }
  return null;
}

function openJadwalJagaPage() {
  setActiveNavById('');
  switchPage('jadwalJagaPage');
  history.pushState({ jadwalJaga: true }, '');
  if (!_jagaCurrentWeekStart_) _jagaCurrentWeekStart_ = _jagaGetMonday_(new Date());
  _jagaLoadShiftConfig_().then(function() {
    _renderJadwalJagaWeek_();
  });
}

function _jagaPrevWeek_() {
  _jagaCurrentWeekStart_.setDate(_jagaCurrentWeekStart_.getDate() - 7);
  _renderJadwalJagaWeek_();
}

function _jagaNextWeek_() {
  _jagaCurrentWeekStart_.setDate(_jagaCurrentWeekStart_.getDate() + 7);
  _renderJadwalJagaWeek_();
}

function _renderJadwalJagaWeek_() {
  var loading = document.getElementById('jagaLoading');
  var empty   = document.getElementById('jagaEmptyState');
  var list    = document.getElementById('jagaWeekList');
  var label   = document.getElementById('jagaWeekRangeLabel');

  var monday = new Date(_jagaCurrentWeekStart_);
  var sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  var startDate = _jagaFmtDate_(monday);
  var endDate   = _jagaFmtDate_(sunday);

  if (label) {
    var fmt = function(d) { return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); };
    label.textContent = fmt(monday) + ' - ' + fmt(sunday);
  }

  // Default tanggal terpilih: hari ini jika ada di minggu ini, selain itu Senin
  var todayKey = _jagaFmtDate_(new Date());
  if (!_jagaSelectedDate_ || _jagaSelectedDate_ < startDate || _jagaSelectedDate_ > endDate) {
    _jagaSelectedDate_ = (todayKey >= startDate && todayKey <= endDate) ? todayKey : startDate;
  }

  if (empty) empty.classList.add('hidden');
  if (list) list.innerHTML = '';

  var cacheKey = startDate + '_' + endDate;
  if (_jagaCache_[cacheKey]) {
    _renderJagaDateStrip_(monday);
    _renderJagaWeekList_(_jagaCache_[cacheKey], monday);
    return;
  }

  if (loading) { loading.classList.remove('hidden'); loading.style.display = 'flex'; }

  gasGet_('getJadwalJaga', { startDate: startDate, endDate: endDate }).then(function(res) {
    if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
    var data = (res && res.ok) ? (res.data || {}) : {};
    _jagaCache_[cacheKey] = data;
    _renderJagaDateStrip_(monday);
    _renderJagaWeekList_(data, monday);
  }).catch(function() {
    if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
    if (list) list.innerHTML = '<div class="text-center text-red-400 text-sm py-10">Gagal memuat jadwal. <button onclick="_renderJadwalJagaWeek_()" class="text-rose-500 font-semibold underline">Coba lagi</button></div>';
  });
}

function _renderJagaDateStrip_(monday) {
  var strip = document.getElementById('jagaDateStrip');
  if (!strip) return;

  var dayAbbr = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  var todayKey = _jagaFmtDate_(new Date());
  var html = '';

  for (var i = 0; i < 7; i++) {
    var d = new Date(monday);
    d.setDate(d.getDate() + i);
    var key = _jagaFmtDate_(d);
    var isToday = key === todayKey;
    var isSelected = key === _jagaSelectedDate_;

    var chipClass = isSelected ? 'bg-primary text-white' : 'bg-gray-50 text-gray-700';
    var abbrClass = isSelected ? 'text-white/80' : 'text-gray-400';
    var dotClass = isSelected ? 'bg-white' : 'bg-primary';

    html += '<button onclick="_jagaSelectDay_(\'' + key + '\')" class="flex-shrink-0 w-12 flex flex-col items-center gap-1 py-2 rounded-2xl ' + chipClass + ' transition">';
    html += '<span class="text-[10px] font-semibold uppercase ' + abbrClass + '">' + dayAbbr[d.getDay()] + '</span>';
    html += '<span class="text-base font-bold">' + d.getDate() + '</span>';
    html += '<span class="w-1.5 h-1.5 rounded-full ' + (isToday ? dotClass : 'bg-transparent') + '"></span>';
    html += '</button>';
  }

  strip.innerHTML = html;
}

function _jagaSelectDay_(dateStr) {
  _jagaSelectedDate_ = dateStr;
  var monday = new Date(_jagaCurrentWeekStart_);
  var sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  var cacheKey = _jagaFmtDate_(monday) + '_' + _jagaFmtDate_(sunday);
  var data = _jagaCache_[cacheKey] || {};
  _renderJagaDateStrip_(monday);
  _renderJagaWeekList_(data, monday);
}

function _renderJagaWeekList_(data, monday) {
  var empty = document.getElementById('jagaEmptyState');
  var list  = document.getElementById('jagaWeekList');
  if (!list) return;

  if (empty) empty.classList.add('hidden');

  var shiftNames = (_jagaShiftConfig_ && _jagaShiftConfig_.length)
    ? _jagaShiftConfig_.map(function(s) { return s.name; })
    : ['Pagi','Siang','Malam'];

  var dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis',"Jum'at",'Sabtu'];
  var todayKey = _jagaFmtDate_(new Date());

  var key = _jagaSelectedDate_;
  var d = new Date(key + 'T00:00:00');
  var entry = data[key] || { warga: [], security: {} };

  var wargaList = entry.warga || [];
  var security  = entry.security || {};
  var securityTotal = shiftNames.reduce(function(sum, shift) {
    return sum + (security[shift] || []).length;
  }, 0);

  var dateLabel = dayNames[d.getDay()] + ', ' + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
  var isToday = todayKey === key;

  var html = '';
  html += '<div class="bg-white rounded-3xl border ' + (isToday ? 'border-primary bg-blue-50/30' : 'border-gray-100') + ' p-4 shadow-sm">';
  html += '<div class="flex items-center justify-between mb-3">';
  html += '<p class="text-sm font-bold text-gray-900">' + dateLabel + '</p>';
  if (isToday) html += '<span class="text-[10px] font-bold text-white bg-primary px-2 py-0.5 rounded-full">Hari ini</span>';
  html += '</div>';

  // Piket Warga
  html += '<p class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Piket Warga</p>';
  if (wargaList.length) {
    html += '<div class="flex flex-col gap-2 mb-4">';
    wargaList.forEach(function(w) {
      html += _jagaPersonRowHtml_(w.nama, 'Blok ' + (w.blok || '-'), w.noHp, '#FFEDD5', '#C2410C');
    });
    html += '</div>';
  } else {
    html += '<p class="text-sm text-gray-300 mb-4">Belum ada jadwal</p>';
  }

  // Roster Security
  html += '<p class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Security</p>';
  if (securityTotal) {
    html += '<div class="flex flex-col gap-2">';
    shiftNames.forEach(function(shift) {
      var arr = security[shift] || [];
      if (!arr.length) return;
      var timeLabel = _jagaShiftTimeLabel_(shift);
      var subtitle = shift + (timeLabel ? ' · ' + timeLabel : '');
      arr.forEach(function(s) {
        html += _jagaPersonRowHtml_(s.nama, subtitle, s.noHp, '#DBEAFE', '#1D4ED8');
      });
    });
    html += '</div>';
  } else {
    html += '<p class="text-sm text-gray-300">Belum ada jadwal</p>';
  }

  html += '</div>';

  list.innerHTML = html;
}

// ===== ADMIN: ROSTER SECURITY (Jadwal Jaga) =====

var _jagaAdminWeekStart_ = null; // Date (Senin)
var _jagaAdminSecurityList_ = null; // cache getSecurityContacts
var _jagaAdminDataCache_ = {}; // key 'start_end' -> array entries
var _jagaAdminLastMonday_ = null;
var _jagaAdminLastSecurityList_ = [];
var _jagaAdminLastEntries_ = [];

function openJadwalJagaAdmin() {
  if (!_jagaAdminWeekStart_) _jagaAdminWeekStart_ = _jagaGetMonday_(new Date());
  _jagaLoadShiftConfig_().then(function() {
    _renderJagaAdminTable_();
    _jagaGenInit_();
  });
}

function _jagaAdminPrevWeek_() {
  _jagaAdminWeekStart_.setDate(_jagaAdminWeekStart_.getDate() - 7);
  _renderJagaAdminTable_();
}

function _jagaAdminNextWeek_() {
  _jagaAdminWeekStart_.setDate(_jagaAdminWeekStart_.getDate() + 7);
  _renderJagaAdminTable_();
}

function _renderJagaAdminTable_() {
  var label = document.getElementById('jagaAdminWeekRangeLabel');
  var table = document.getElementById('jagaAdminTable');
  if (!table) return;

  var monday = new Date(_jagaAdminWeekStart_);
  var sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  var startDate = _jagaFmtDate_(monday);
  var endDate   = _jagaFmtDate_(sunday);

  if (label) {
    var fmt = function(d) { return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); };
    label.textContent = fmt(monday) + ' - ' + fmt(sunday);
  }

  table.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Memuat...</p>';

  var loadSecurity = _jagaAdminSecurityList_
    ? Promise.resolve(_jagaAdminSecurityList_)
    : gasGet_('getSecurityContacts').then(function(res) {
        _jagaAdminSecurityList_ = (res && res.ok) ? (res.data || []) : [];
        return _jagaAdminSecurityList_;
      });

  var loadEntries = gasGet_('adminGetJadwalSecurity', {
    startDate: startDate,
    endDate: endDate,
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    return (res && res.ok) ? (res.data || []) : [];
  });

  Promise.all([loadSecurity, loadEntries]).then(function(results) {
    _jagaAdminLastMonday_ = monday;
    _jagaAdminLastSecurityList_ = results[0];
    _jagaAdminLastEntries_ = results[1];
    _renderJagaAdminTableContent_(monday, results[0], results[1]);
  }).catch(function() {
    table.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data.</p>';
  });
}

function _renderJagaAdminTableContent_(monday, securityList, entries) {
  var table = document.getElementById('jagaAdminTable');
  if (!table) return;

  var dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis',"Jum'at",'Sabtu'];
  var shifts = (_jagaShiftConfig_ || []).map(function(s) { return s.name; });
  if (!shifts.length) shifts = ['Pagi','Siang','Malam'];

  // Map: 'yyyy-MM-dd|Shift' -> array entries
  var entryMap = {};
  entries.forEach(function(e) {
    var k = e.tanggal + '|' + e.shift;
    if (!entryMap[k]) entryMap[k] = [];
    entryMap[k].push(e);
  });

  var addOptions = '<option value="">+ Tambah personil</option>' + securityList.map(function(s) {
    return '<option value="' + _escHtml_(s.nama) + '|' + _escHtml_(s.noHp) + '">' + _escHtml_(s.nama) + '</option>';
  }).join('');

  var html = '';
  for (var i = 0; i < 7; i++) {
    var d = new Date(monday);
    d.setDate(d.getDate() + i);
    var key = _jagaFmtDate_(d);
    var dateLabel = dayNames[d.getDay()] + ', ' + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

    html += '<div class="bg-gray-50 rounded-2xl px-4 py-3">';
    html += '<p class="text-sm font-semibold text-gray-900 mb-2">' + dateLabel + '</p>';
    html += '<div class="grid gap-2" style="grid-template-columns:repeat(' + shifts.length + ',1fr)">';
    shifts.forEach(function(shift) {
      var cellEntries = entryMap[key + '|' + shift] || [];
      html += '<div>';
      html += '<label class="text-[10px] font-semibold text-gray-400 block mb-1">' + _escHtml_(shift) + '</label>';
      html += '<div class="space-y-1 mb-1">';
      cellEntries.forEach(function(e) {
        html += '<div class="flex items-center justify-between gap-1 bg-white border border-gray-200 rounded-lg px-1.5 py-1">' +
          '<span class="text-[11px] text-gray-700 truncate">' + _escHtml_(e.nama || '') + '</span>' +
          '<button onclick="_jagaAdminDeleteEntry_(this, \'' + e.id + '\')" class="text-gray-300 active:text-red-500 flex-shrink-0">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>';
      });
      html += '</div>';
      html += '<select onchange="_jagaAdminAddCell_(this, \'' + key + '\', \'' + _escHtml_(shift) + '\')" class="w-full text-[11px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white">';
      html += addOptions;
      html += '</select>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
  }

  table.innerHTML = html;
}

function _jagaAdminAddCell_(selectEl, tanggal, shift) {
  var val = selectEl.value;
  if (!val) return;
  var parts = val.split('|');
  var nama = parts[0];
  var noHp = parts[1] || '';

  var tempId = '_tmp_' + Date.now() + '_' + Math.random().toString(36).slice(-4);
  var optimisticEntry = { id: tempId, tanggal: tanggal, shift: shift, nama: nama, noHp: noHp };
  _jagaAdminLastEntries_.push(optimisticEntry);
  _renderJagaAdminTableContent_(_jagaAdminLastMonday_, _jagaAdminLastSecurityList_, _jagaAdminLastEntries_);

  gasPost_('adminAddJadwalSecurity', {
    payload: { tanggal: tanggal, shift: shift, nama: nama, noHp: noHp },
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    if (!res || !res.ok) {
      var idx = _jagaAdminLastEntries_.indexOf(optimisticEntry);
      if (idx >= 0) _jagaAdminLastEntries_.splice(idx, 1);
      _renderJagaAdminTableContent_(_jagaAdminLastMonday_, _jagaAdminLastSecurityList_, _jagaAdminLastEntries_);
      showToast('Gagal menyimpan jadwal: ' + ((res && res.error) || 'unknown error'), 'error');
      return;
    }
    if (res.id) optimisticEntry.id = res.id;
    showToast('Personil ditambahkan', 'success');
    _jagaCache_ = {}; // invalidate cache halaman warga
  }).catch(function() {
    var idx = _jagaAdminLastEntries_.indexOf(optimisticEntry);
    if (idx >= 0) _jagaAdminLastEntries_.splice(idx, 1);
    _renderJagaAdminTableContent_(_jagaAdminLastMonday_, _jagaAdminLastSecurityList_, _jagaAdminLastEntries_);
    showToast('Gagal menyimpan jadwal', 'error');
  });
}

function _jagaAdminDeleteEntry_(btnEl, id) {
  var idx = -1;
  for (var i = 0; i < _jagaAdminLastEntries_.length; i++) {
    if (_jagaAdminLastEntries_[i].id === id) { idx = i; break; }
  }
  var removed = idx >= 0 ? _jagaAdminLastEntries_.splice(idx, 1)[0] : null;
  _renderJagaAdminTableContent_(_jagaAdminLastMonday_, _jagaAdminLastSecurityList_, _jagaAdminLastEntries_);

  gasPost_('adminDeleteJadwalSecurity', {
    id: id,
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    if (!res || !res.ok) {
      if (removed) _jagaAdminLastEntries_.splice(idx, 0, removed);
      _renderJagaAdminTableContent_(_jagaAdminLastMonday_, _jagaAdminLastSecurityList_, _jagaAdminLastEntries_);
      showToast('Gagal menghapus personil: ' + ((res && res.error) || 'unknown error'), 'error');
      return;
    }
    showToast('Personil dihapus', 'success');
    _jagaCache_ = {}; // invalidate cache halaman warga
  }).catch(function() {
    if (removed) _jagaAdminLastEntries_.splice(idx, 0, removed);
    _renderJagaAdminTableContent_(_jagaAdminLastMonday_, _jagaAdminLastSecurityList_, _jagaAdminLastEntries_);
    showToast('Gagal menghapus personil', 'error');
  });
}

// ===== ADMIN: PENGATURAN SHIFT (dinamis 2-3 shift) =====

function _jagaToggleShiftConfigForm_() {
  var form = document.getElementById('jagaShiftConfigForm');
  if (!form) return;
  if (form.classList.contains('hidden')) {
    _jagaLoadShiftConfig_().then(function(shifts) {
      _jagaRenderShiftConfigForm_(shifts);
      form.classList.remove('hidden');
    });
  } else {
    form.classList.add('hidden');
  }
}

function _jagaRenderShiftConfigForm_(shifts) {
  var form = document.getElementById('jagaShiftConfigForm');
  if (!form) return;

  var rowsHtml = shifts.map(function(s, idx) {
    return '<div class="jagaShiftRow bg-white border border-gray-200 rounded-xl p-2 space-y-1.5">' +
      '<div class="flex items-center gap-1.5">' +
        '<input type="text" class="jagaShiftName flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" placeholder="Nama shift" value="' + _escHtml_(s.name) + '">' +
        '<button onclick="_jagaRemoveShiftRow_(this)" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="flex items-center gap-1.5">' +
        '<input type="time" class="jagaShiftStart flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" value="' + _escHtml_(s.start) + '">' +
        '<span class="text-xs text-gray-400">–</span>' +
        '<input type="time" class="jagaShiftEnd flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" value="' + _escHtml_(s.end) + '">' +
      '</div>' +
    '</div>';
  }).join('');

  form.innerHTML =
    '<div id="jagaShiftRows" class="space-y-1.5">' + rowsHtml + '</div>' +
    '<div class="flex items-center gap-2 pt-1">' +
      '<button onclick="_jagaAddShiftRow_()" class="text-xs font-semibold text-blue-600 active:text-blue-800">+ Tambah shift</button>' +
      '<button id="jagaSaveShiftBtn" onclick="_jagaSaveShiftConfig_()" class="ml-auto text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-xl active:scale-95 transition flex items-center justify-center gap-1.5">Simpan</button>' +
    '</div>';
}

function _jagaAddShiftRow_() {
  var rows = document.getElementById('jagaShiftRows');
  if (!rows) return;
  if (rows.querySelectorAll('.jagaShiftRow').length >= 3) {
    showToast('Maksimal 3 shift', 'error');
    return;
  }
  var div = document.createElement('div');
  div.className = 'jagaShiftRow bg-white border border-gray-200 rounded-xl p-2 space-y-1.5';
  div.innerHTML =
    '<div class="flex items-center gap-1.5">' +
      '<input type="text" class="jagaShiftName flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" placeholder="Nama shift" value="">' +
      '<button onclick="_jagaRemoveShiftRow_(this)" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="flex items-center gap-1.5">' +
      '<input type="time" class="jagaShiftStart flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" value="00:00">' +
      '<span class="text-xs text-gray-400">–</span>' +
      '<input type="time" class="jagaShiftEnd flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" value="00:00">' +
    '</div>';
  rows.appendChild(div);
}

function _jagaRemoveShiftRow_(btnEl) {
  var rows = document.getElementById('jagaShiftRows');
  if (!rows) return;
  if (rows.querySelectorAll('.jagaShiftRow').length <= 2) {
    showToast('Minimal 2 shift', 'error');
    return;
  }
  btnEl.closest('.jagaShiftRow').remove();
}

function _jagaSaveShiftConfig_() {
  var rows = document.querySelectorAll('#jagaShiftRows .jagaShiftRow');
  var shifts = [];
  for (var i = 0; i < rows.length; i++) {
    var name = rows[i].querySelector('.jagaShiftName').value.trim();
    var start = rows[i].querySelector('.jagaShiftStart').value;
    var end = rows[i].querySelector('.jagaShiftEnd').value;
    if (!name || !start || !end) {
      showToast('Nama & jam shift tidak boleh kosong', 'error');
      return;
    }
    shifts.push({ name: name, start: start, end: end });
  }

  var btn = document.getElementById('jagaSaveShiftBtn');
  var originalLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-70');
    btn.innerHTML =
      '<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/>' +
        '<path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/>' +
      '</svg>' +
      'Menyimpan...';
  }

  function restoreBtn() {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('opacity-70');
    btn.innerHTML = originalLabel;
  }

  gasPost_('adminSaveJagaShiftConfig', {
    shifts: shifts,
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    if (!res || !res.ok) {
      showToast('Gagal menyimpan konfigurasi shift: ' + ((res && res.error) || 'unknown error'), 'error');
      restoreBtn();
      return;
    }
    showToast('Konfigurasi shift tersimpan', 'success');
    restoreBtn();
    _jagaShiftConfig_ = res.shifts;
    _jagaCache_ = {};
    _jagaAdminDataCache_ = {};
    document.getElementById('jagaShiftConfigForm').classList.add('hidden');
    _renderJagaAdminTable_();
    _jagaGenPopulateShiftOptions_();
  }).catch(function() {
    showToast('Gagal menyimpan konfigurasi shift', 'error');
    restoreBtn();
  });
}

// ===== ADMIN: GENERATOR ROTASI PIKET WARGA =====

var _jagaGenLastBatchId_ = null;
var _jagaGenInited_ = false;

function _jagaGenInit_() {
  if (_jagaGenInited_) return;
  _jagaGenInited_ = true;

  var startEl = document.getElementById('jagaGenStartDate');
  if (startEl && !startEl.value) startEl.value = _jagaFmtDate_(new Date());

  var hariWrap = document.getElementById('jagaGenHariPiket');
  if (hariWrap) {
    var dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis',"Jum'at",'Sabtu'];
    var html = '';
    dayNames.forEach(function(name, idx) {
      html += '<label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-gray-200 text-xs cursor-pointer">' +
        '<input type="checkbox" class="jagaGenHari" value="' + idx + '" ' + ((idx >= 1 && idx <= 5) ? 'checked' : '') + '> ' + name +
        '</label>';
    });
    hariWrap.innerHTML = html;
  }

  _jagaLoadShiftConfig_().then(function() { _jagaGenPopulateShiftOptions_(); });
}

function _jagaGenPopulateShiftOptions_() {
  var shiftEl = document.getElementById('jagaGenShift');
  if (!shiftEl || !_jagaShiftConfig_) return;
  var current = shiftEl.value;
  shiftEl.innerHTML = _jagaShiftConfig_.map(function(s) {
    return '<option value="' + _escHtml_(s.name) + '">' + _escHtml_(s.name) + '</option>';
  }).join('');
  var names = _jagaShiftConfig_.map(function(s) { return s.name; });
  shiftEl.value = (names.indexOf(current) !== -1) ? current : (names.indexOf('Malam') !== -1 ? 'Malam' : names[0]);
}

function _jagaGenGetPayload_() {
  var startDate = document.getElementById('jagaGenStartDate').value;
  var jumlahMinggu = parseInt(document.getElementById('jagaGenJumlahMinggu').value, 10) || 1;
  var shift = document.getElementById('jagaGenShift').value;
  var hariPiket = Array.from(document.querySelectorAll('.jagaGenHari:checked')).map(function(el) { return parseInt(el.value, 10); });
  var overwrite = document.getElementById('jagaGenOverwrite').checked;
  return { startDate: startDate, jumlahMinggu: jumlahMinggu, shift: shift, hariPiket: hariPiket, overwrite: overwrite };
}

function _jagaGenPreview_() {
  var payload = _jagaGenGetPayload_();
  var result = document.getElementById('jagaGenPreviewResult');
  var genBtn = document.getElementById('jagaGenGenerateBtn');

  if (!payload.startDate || !payload.hariPiket.length) {
    showToast('Pilih tanggal mulai & minimal 1 hari piket', 'error');
    return;
  }

  if (result) result.innerHTML = '<p class="text-sm text-gray-400 text-center py-3">Memuat preview...</p>';
  if (genBtn) genBtn.disabled = true;

  gasGet_('previewJadwalPiketWarga', {
    startDate: payload.startDate,
    jumlahMinggu: payload.jumlahMinggu,
    shift: payload.shift,
    hariPiket: payload.hariPiket.join(','),
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    if (!res || !res.ok) {
      if (result) result.innerHTML = '<p class="text-sm text-red-400 text-center py-3">' + ((res && res.error) || 'Gagal memuat preview') + '</p>';
      return;
    }
    if (!res.data.length) {
      if (result) result.innerHTML = '<p class="text-sm text-gray-400 text-center py-3">Tidak ada tanggal piket pada rentang ini.</p>';
      return;
    }
    if (result) {
      result.innerHTML = res.data.map(function(d) {
        var dateLabel = new Date(d.tanggal + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
        var skipBadge = d.skip ? '<span class="text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full ml-2">Sudah ada — dilewati</span>' : '';
        return '<div class="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between text-sm">' +
          '<span class="text-gray-700">' + dateLabel + ' — ' + _escHtml_(d.blok) + ' (' + _escHtml_(d.nama || '-') + ')</span>' +
          skipBadge +
          '</div>';
      }).join('');
    }
    if (genBtn) genBtn.disabled = false;
  }).catch(function() {
    if (result) result.innerHTML = '<p class="text-sm text-red-400 text-center py-3">Gagal memuat preview</p>';
  });
}

function _jagaGenGenerate_() {
  var payload = _jagaGenGetPayload_();
  var genBtn = document.getElementById('jagaGenGenerateBtn');

  if (!confirm('Generate rotasi piket warga untuk ' + payload.jumlahMinggu + ' minggu ke depan?')) return;

  if (genBtn) genBtn.disabled = true;

  gasPost_('generateJadwalPiketWarga', {
    payload: payload,
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    if (genBtn) genBtn.disabled = false;
    if (!res || !res.ok) {
      showToast('Gagal generate: ' + ((res && res.error) || 'unknown error'), 'error');
      return;
    }
    showToast('Berhasil generate ' + res.count + ' jadwal piket', 'success');
    _jagaCache_ = {};
    _jagaGenLastBatchId_ = res.batchId;
    var delBtn = document.getElementById('jagaGenDeleteBatchBtn');
    if (delBtn) delBtn.classList.remove('hidden');
    var result = document.getElementById('jagaGenPreviewResult');
    if (result) result.innerHTML = '';
  }).catch(function() {
    if (genBtn) genBtn.disabled = false;
    showToast('Gagal generate jadwal', 'error');
  });
}

function _jagaGenDeleteLastBatch_() {
  if (!_jagaGenLastBatchId_) return;
  if (!confirm('Hapus batch jadwal yang baru saja di-generate?')) return;

  gasPost_('deleteJadwalPiketBatch', {
    batchId: _jagaGenLastBatchId_,
    adminEmail: (currentUser && currentUser.email) || ''
  }).then(function(res) {
    if (!res || !res.ok) {
      showToast('Gagal menghapus batch', 'error');
      return;
    }
    showToast('Batch dihapus (' + res.count + ' jadwal)', 'success');
    _jagaCache_ = {};
    _jagaGenLastBatchId_ = null;
    var delBtn = document.getElementById('jagaGenDeleteBatchBtn');
    if (delBtn) delBtn.classList.add('hidden');
  }).catch(function() {
    showToast('Gagal menghapus batch', 'error');
  });
}

/* ════════════════════════════════════════════════
   BOTTOM NAV — Instagram-style scroll shrink
   Scroll down (finger up / reading down) → shrink to 80%
   Scroll up   (finger down)              → rest at 95%
   ════════════════════════════════════════════════ */
(function () {
  var nav = document.getElementById('bottomNav');
  if (!nav) return;

  var BASE = 'translateX(-50%)';
  var NORMAL = 0.95;         // resting size
  var SHRINK = 0.75;         // shrunk size
  var THRESHOLD = 6;         // ignore tiny jitters (px)
  var shrunk = false;
  var ticking = false;

  function setShrunk(on) {
    if (on === shrunk) return;
    shrunk = on;
    if (on) {
      nav.style.transform = BASE + ' scale(' + SHRINK + ')';
      nav.style.opacity = '0.92';
    } else {
      nav.style.transform = BASE + ' scale(' + NORMAL + ')';
      nav.style.opacity = '1';
    }
  }

  // resting state on load
  nav.style.transform = BASE + ' scale(' + NORMAL + ')';

  // Track scroll per element (each .app-page scrolls independently)
  var lastY = new WeakMap();

  function onScroll(e) {
    var el = e.target;
    if (!el || el === document) return;
    if (typeof el.scrollTop !== 'number') return;

    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = el.scrollTop;
      var prev = lastY.has(el) ? lastY.get(el) : y;
      var dy = y - prev;
      lastY.set(el, y);

      if (Math.abs(dy) < THRESHOLD) return;
      if (y <= 4) { setShrunk(false); return; } // always full at top
      setShrunk(dy > 0);  // scrolling content up (reading down) → shrink
    });
  }

  // Capture phase so it catches scroll on any inner scroll container
  document.addEventListener('scroll', onScroll, true);
})();

/* ════════════════════════════════════════════════
   FEATURE FLAGS — toggle shortcut menu depan (global)
   Admin atur di Admin > Menu Depan; tersimpan di backend (ScriptProperties).
   ════════════════════════════════════════════════ */
var _featureFlags_ = { votingEnabled: true, lomba17Enabled: true, suratEnabled: true };

// Peta flag → elemen yang di-show/hide + tombol toggle + label
var _FEATURE_FLAG_MAP_ = {
  votingEnabled:  { target: 'votingShortcut', toggle: 'toggleVotingShortcut', label: 'Shortcut Voting' },
  lomba17Enabled: { target: 'formBtnLomba17',  toggle: 'toggleLomba17',        label: 'Form Lomba 17 Agustus' },
  suratEnabled:   { target: 'formBtnSurat',    toggle: 'toggleSurat',          label: 'Form Surat Pengantar' }
};

function applyFeatureFlags(flags) {
  Object.keys(_FEATURE_FLAG_MAP_).forEach(function(key) {
    if (flags && typeof flags[key] !== 'undefined') _featureFlags_[key] = !!flags[key];
    var cfg = _FEATURE_FLAG_MAP_[key];
    var el = document.getElementById(cfg.target);
    if (el) el.style.display = _featureFlags_[key] ? '' : 'none';
    _syncFlagToggleUI_(key);
  });
  _applyHomeMenuLimit_();
}

/* ── Home menu: maksimal 8 tile; bila > 8 → slot ke-8 jadi "Lihat Semua" ── */
var _HOME_MENU_LIMIT_ = 8;

function _homeMenuItems_() {
  var grid = document.getElementById('homeMenuGrid');
  if (!grid) return { grid: null, tile: null, items: [] };
  var tile = document.getElementById('menuViewAllTile');
  var items = Array.prototype.filter.call(grid.children, function(b) {
    return b.tagName === 'BUTTON' && b !== tile;
  });
  return { grid: grid, tile: tile, items: items };
}

function _applyHomeMenuLimit_() {
  var ctx = _homeMenuItems_();
  if (!ctx.grid) return;
  // reset item yang sebelumnya disembunyikan krn overflow (pakai class 'hidden',
  // independen dari style.display yang dipakai feature-flag)
  ctx.items.forEach(function(b) {
    if (b.dataset.ov === '1') { b.classList.remove('hidden'); delete b.dataset.ov; }
  });
  // item yang benar2 tampil (setelah feature-flag) — abaikan yg display:none
  var visible = ctx.items.filter(function(b) { return getComputedStyle(b).display !== 'none'; });

  if (visible.length <= _HOME_MENU_LIMIT_) {
    if (ctx.tile) ctx.tile.style.display = 'none';
    return;
  }
  // > limit: tampilkan 7 pertama, sisanya pindah ke "Lihat Semua"
  visible.forEach(function(b, i) {
    if (i >= _HOME_MENU_LIMIT_ - 1) { b.classList.add('hidden'); b.dataset.ov = '1'; }
  });
  if (ctx.tile) ctx.tile.style.display = '';
}

// Menu yang TERSEDIA (tidak disembunyikan feature-flag) = tampil ATAU overflow
function _homeMenuAvailable_() {
  var ctx = _homeMenuItems_();
  return ctx.items.filter(function(b) {
    return b.dataset.ov === '1' || getComputedStyle(b).display !== 'none';
  });
}

function openMenuAllSheet() {
  var overlay = document.getElementById('menuAllOverlay');
  var gridEl = document.getElementById('menuAllGrid');
  if (!overlay || !gridEl) return;
  if (navigator.vibrate) navigator.vibrate(20);

  // bangun ulang dari sumber tunggal (clone tile menu home)
  gridEl.innerHTML = '';
  _homeMenuAvailable_().forEach(function(btn) {
    var clone = btn.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.display = '';
    delete clone.dataset.ov;
    gridEl.appendChild(clone);
  });
  // klik item mana pun → tutup sheet (onclick asli tetap jalan)
  gridEl.addEventListener('click', function(e) {
    if (e.target.closest('button')) closeMenuAllSheet();
  }, { once: true });

  overlay.classList.remove('hidden');
}

function closeMenuAllSheet() {
  var overlay = document.getElementById('menuAllOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function loadFeatureFlags() {
  return gasGet_('getFeatureFlags').then(function(res) {
    if (res && res.ok && res.flags) applyFeatureFlags(res.flags);
  }).catch(function() { /* offline → biarkan default (tampil) */ });
}

/* ===== NAMA PERUMAHAN — dinamis dari OrgSettings.namaPerumahan =====
   Dipakai sebagai tagline splash & subjudul brand. Di-cache di localStorage
   agar tampil instan saat splash (sebelum fetch selesai). */
window.PWP_PERUMAHAN = '';
function applyPerumahanName(name) {
  name = (name || '').trim();
  window.PWP_PERUMAHAN = name;
  var sp = document.getElementById('splashPerumahan');
  if (sp) sp.textContent = name;
  // Label nama perumahan di seluruh app — hanya ditimpa jika sudah dikonfigurasi
  if (name) {
    document.querySelectorAll('.js-perumahan').forEach(function(el) { el.textContent = name; });
    if (document.title.indexOf('—') > -1) document.title = 'PWP — ' + name;
  }
}
/* Rekening IPL dinamis dari OrgSettings — fallback ke nilai existing bila kosong.
   Keys: bankNama, noRek, rekeningAtasNama */
function applyOrgRekening_(s) {
  if (!s) return;
  var bank = (s.bankNama || '').trim();
  var noRek = (s.noRek || '').trim();
  var atasNama = (s.rekeningAtasNama || '').trim();
  if (noRek) {
    ['rekNoBayar', 'rekNoInfo'].forEach(function(id) { var el = document.getElementById(id); if (el) el.textContent = noRek; });
    var rk = document.getElementById('rekening'); if (rk) rk.value = noRek;
    window.PWP_NOREK = noRek;
  }
  if (bank) { var bk = document.getElementById('bank'); if (bk) bk.value = bank; }
  if (bank || atasNama) {
    var line = (bank || 'BCA') + ' · a.n. ' + (atasNama || '-');
    ['rekLineBayar', 'rekLineInfo'].forEach(function(id) { var el = document.getElementById(id); if (el) el.textContent = line; });
  }
}

/* ===== TARIF IPL dinamis (1-3) dari OrgSettings ===== */
window.PWP_TARIFS = [];
function _tarifFromSettings_(s) {
  var a = [];
  for (var i = 1; i <= 3; i++) {
    var label = String((s && s['tarif' + i + 'Label']) || '').trim();
    var nominal = parseInt(String((s && s['tarif' + i + 'Nominal']) || '').replace(/[^0-9]/g, ''), 10) || 0;
    if (nominal > 0) a.push({ label: label || ('Tarif ' + i), nominal: nominal });
  }
  return a;
}
function _rateMatchesTarif_(rate, nominal, res) {
  rate = Number(rate) || 0;
  if (!rate || !nominal) return false;
  if (rate === nominal) return true;
  if (res && res.bloks && res.bloks.length > 1) {
    var n = res.bloks.length;
    if (rate % nominal === 0 && rate / nominal === n) return true;   // semua blok tarif ini
    var rb = res.rateByBlok || {};
    for (var k in rb) { if (Number(rb[k]) === nominal) return true; } // mixed
  }
  return false;
}
function _escTarif_(t) { return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderTarifCards_(opts) {
  opts = opts || {};
  var grid = document.getElementById('tarifGrid');
  if (!grid) return;
  var tarifs = (window.PWP_TARIFS && window.PWP_TARIFS.length)
    ? window.PWP_TARIFS
    : [{ label: 'Dihuni', nominal: 200000 }, { label: 'Tidak Dihuni', nominal: 175000 }];
  var loggedIn = !!opts.loggedIn;
  var rate = (opts.rate != null) ? Number(opts.rate) : null;
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(' + tarifs.length + ',minmax(0,1fr))';
  var badge = '<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:#1d4ed8;background:#dbeafe;border-radius:999px;padding:2px 7px;margin-left:6px;letter-spacing:0.02em;vertical-align:middle;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>Tarif Anda</span>';
  var html = tarifs.map(function (t, idx) {
    var match = loggedIn && rate != null && _rateMatchesTarif_(rate, t.nominal, opts.res);
    var last = idx === tarifs.length - 1;
    var nom = loggedIn ? ('Rp' + Number(t.nominal).toLocaleString('id-ID')) : 'Rp&nbsp;<span style="letter-spacing:2px">••••••</span>';
    var style = 'padding:12px 16px;transition:all .3s;'
      + 'border-top:3px solid ' + (match ? '#2563eb' : 'transparent') + ';'
      + (last ? '' : ('border-right:1px solid ' + (match ? '#bfdbfe' : '#f3f4f6') + ';'))
      + 'background:' + (match ? '#eff6ff' : (loggedIn ? '#fafafa' : '#fff')) + ';'
      + 'opacity:' + ((loggedIn && !match) ? '0.55' : '1') + ';';
    return '<div style="' + style + '">'
      + '<p class="text-[9px] uppercase tracking-widest font-semibold" style="color:' + (match ? '#1d4ed8' : '#9ca3af') + '">' + _escTarif_(t.label) + (match ? badge : '') + '</p>'
      + '<p class="text-sm font-black mt-0.5" style="color:' + (match ? '#1d4ed8' : '#111827') + '">' + nom + '</p>'
      + '<p class="text-[9px] text-gray-400">/ bulan</p></div>';
  }).join('');
  grid.innerHTML = html;
}

/* Kartu pilih tarif di form Bayar (1-3 dinamis dari OrgSettings). */
function renderHunianCards_() {
  var box = document.getElementById('hunianCards');
  if (!box) return;
  var tarifs = (window.PWP_TARIFS && window.PWP_TARIFS.length)
    ? window.PWP_TARIFS
    : [{ label: 'Dihuni', nominal: 200000 }, { label: 'Tidak Dihuni', nominal: 175000 }];
  box.style.gridTemplateColumns = 'repeat(' + Math.min(tarifs.length, 3) + ',minmax(0,1fr))';
  box.innerHTML = tarifs.map(function (t) {
    return '<button type="button" data-value="' + t.nominal + '" data-label="' + _escTarif_(t.label) + '" class="hunian-card">'
      + '<div class="font-medium">' + _escTarif_(t.label) + '</div>'
      + '<div class="text-xs mt-1 opacity-80">Rp' + Number(t.nominal).toLocaleString('id-ID') + ' / bulan</div>'
      + '</button>';
  }).join('');
}

function loadPerumahanName() {
  try { applyPerumahanName(localStorage.getItem('pwp_perumahan') || ''); } catch (_) {}
  return gasGet_('getOrgSettings').then(function(res) {
    if (res && res.ok && res.settings) {
      var nm = res.settings.namaPerumahan || '';
      try { localStorage.setItem('pwp_perumahan', nm); } catch (_) {}
      applyPerumahanName(nm);
      applyOrgRekening_(res.settings);
      window.PWP_TARIFS = _tarifFromSettings_(res.settings);
      renderTarifCards_({ loggedIn: !!(window.currentUser && window.currentUser.email) });
      renderHunianCards_();
    }
  }).catch(function() { /* offline → pakai cache */ });
}
document.addEventListener('DOMContentLoaded', loadPerumahanName);

/* ===== PEDOMAN dinamis dari tab 'Pedoman' (Judul | Link) ===== */
function _pedomanAttr_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function loadPedoman() {
  var box = document.getElementById('pedomanList');
  if (!box) return;
  return gasGet_('getPedoman').then(function(res){
    if (!res || !res.ok || !res.items || !res.items.length) {
      box.innerHTML = '<p class="px-4 py-4 text-xs text-gray-400">Belum ada dokumen.</p>';
      return;
    }
    box.innerHTML = res.items.map(function(it){
      var j = _pedomanAttr_(it.judul);
      return '<a href="#" class="pedoman-item flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 transition" data-fileid="' + _pedomanAttr_(it.fileId) + '" data-judul="' + j + '">'
        + '<div class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">'
        + '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>'
        + '<span class="flex-1 text-sm font-medium text-gray-800">' + j + '</span>'
        + '<svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></a>';
    }).join('');
  }).catch(function(){ box.innerHTML = '<p class="px-4 py-4 text-xs text-gray-400">Gagal memuat dokumen.</p>'; });
}
document.addEventListener('DOMContentLoaded', function(){
  loadPedoman();
  var box = document.getElementById('pedomanList');
  if (box) box.addEventListener('click', function(e){
    var a = e.target.closest('.pedoman-item');
    if (!a) return;
    e.preventDefault();
    openPedomanViewer(a.dataset.fileid, a.dataset.judul);
  });
});

// Sinkronkan tampilan satu switch di Admin > Menu Depan
function _syncFlagToggleUI_(key) {
  var cfg = _FEATURE_FLAG_MAP_[key];
  if (!cfg) return;
  var btn = document.getElementById(cfg.toggle);
  if (!btn) return;
  var on = _featureFlags_[key];
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  btn.style.background = on ? '#3b82f6' : '#D1D5DB';
  var knob = btn.querySelector('span');
  if (knob) knob.style.transform = on ? 'translateX(20px)' : 'translateX(0px)';
}

// Sinkron semua toggle (dipanggil loader tab Admin > Menu Depan)
function _syncVotingToggleUI_() {
  Object.keys(_FEATURE_FLAG_MAP_).forEach(_syncFlagToggleUI_);
}

// Toggle generik dari Admin → simpan global ke backend (semua warga)
function toggleFeatureFlag(key) {
  var cfg = _FEATURE_FLAG_MAP_[key];
  if (!cfg) return;
  var next = !_featureFlags_[key];
  var patch = {}; patch[key] = next;
  applyFeatureFlags(patch); // optimistic
  if (navigator.vibrate) navigator.vibrate(20);
  var body = { payload: patch, adminEmail: (currentUser && currentUser.email) || '' };
  gasPost_('adminSetFeatureFlags', body).then(function(res) {
    if (!res || !res.ok) {
      var rb = {}; rb[key] = !next; applyFeatureFlags(rb); // rollback
      if (typeof showToast === 'function') showToast((res && res.error) || 'Gagal menyimpan', 'error');
      return;
    }
    if (res.flags) applyFeatureFlags(res.flags);
    if (typeof showToast === 'function') showToast(cfg.label + ' ' + (next ? 'ditampilkan' : 'disembunyikan'), 'success');
  }).catch(function() {
    var rb = {}; rb[key] = !next; applyFeatureFlags(rb); // rollback
    if (typeof showToast === 'function') showToast('Gagal menyimpan', 'error');
  });
}

// Kompat: tombol Voting lama
function toggleVotingShortcutSetting() { toggleFeatureFlag('votingEnabled'); }

document.addEventListener('DOMContentLoaded', function () { _applyHomeMenuLimit_(); loadFeatureFlags(); });

/* ════════════════════════════════════════════════
   SEGMENTED CODE INPUT — animasi "matching" (PIN & OTP)
   verifying (wave) → success (pop hijau) / error (shake merah)
   ════════════════════════════════════════════════ */
function _setCodeState_(container, state){
  if(!container) return;
  container.classList.remove('code-verifying','code-success','code-error','code-merge');
  var oldBadge = container.querySelector('.code-result-badge');
  if(oldBadge) oldBadge.remove();
  if(!state) return;
  if(state === 'verifying'){ container.classList.add('code-verifying'); return; }
  // success / error → 6 kotak menabrak ke tengah (merge) lalu muncul 1 badge
  if(getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.classList.add(state === 'success' ? 'code-success' : 'code-error', 'code-merge');
  var badge = document.createElement('div');
  badge.className = 'code-result-badge ' + (state === 'success' ? 'is-success' : 'is-error');
  badge.innerHTML = state === 'success'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  container.appendChild(badge);
}
function _clearCodeBoxes_(container, hiddenEl){
  if(container){
    container.querySelectorAll('.code-box').forEach(function(b){ b.value=''; b.classList.remove('filled'); });
    _setCodeState_(container, null);
    var first=container.querySelector('.code-box'); if(first) try{ first.focus(); }catch(e){}
  }
  if(hiddenEl) hiddenEl.value='';
}
function _initSegmentedCode_(container, hiddenEl, onComplete){
  if(!container || container.dataset.codeInit==='1') return;
  container.dataset.codeInit='1';
  var boxes=Array.prototype.slice.call(container.querySelectorAll('.code-box'));
  function collect(){
    var v=boxes.map(function(b){return b.value||'';}).join('');
    if(hiddenEl) hiddenEl.value=v;
    return v;
  }
  boxes.forEach(function(box,i){
    box.addEventListener('input', function(e){
      var val=String(e.target.value).replace(/[^0-9]/g,'');
      box.value=val; box.classList.toggle('filled', !!val);
      _setCodeState_(container, null); // user mengetik lagi → reset state
      if(val && boxes[i+1]) boxes[i+1].focus();
      var code=collect();
      if(code.length===6 && typeof onComplete==='function') onComplete(code);
    });
    box.addEventListener('keydown', function(e){
      if(e.key==='Backspace' && !box.value && boxes[i-1]) boxes[i-1].focus();
    });
    box.addEventListener('paste', function(e){
      var paste=(((e.clipboardData||window.clipboardData).getData('text'))||'').replace(/[^0-9]/g,'');
      if(!paste) return; e.preventDefault();
      paste.split('').forEach(function(n,k){ if(boxes[k]){ boxes[k].value=n; boxes[k].classList.toggle('filled',!!n);} });
      var code=collect();
      var next=boxes[Math.min(paste.length,5)]; if(next) next.focus();
      if(code.length===6 && typeof onComplete==='function') onComplete(code);
    });
  });
}
function _initPINBoxes_(){
  var c=document.getElementById('sayaPINBoxes');
  if(!c) return;
  _initSegmentedCode_(c, document.getElementById('sayaPINLoginInput'), function(){
    _setCodeState_(c, 'verifying');
    if(typeof loginWithPINSaya==='function') loginWithPINSaya();
  });
}
document.addEventListener('DOMContentLoaded', _initPINBoxes_);

/* ════════════════════════════════════════════════
   AVATAR — pilih foto galeri → compress kecil → simpan ke Sheets (base64)
   ════════════════════════════════════════════════ */
function _pickAvatar_(){
  var inp = document.getElementById('sayaAvatarInput');
  if (inp) inp.click();
}

function _onAvatarSelected_(e){
  var file = e.target.files && e.target.files[0];
  e.target.value = ''; // reset agar file sama bisa dipilih lagi
  if (!file) return;
  if (!/^image\//.test(file.type)) { if (typeof showToast === 'function') showToast('File harus berupa gambar', 'error'); return; }
  _compressAvatar_(file).then(function(dataUrl){
    if (currentUser) currentUser.avatar = dataUrl; // preview optimistik
    if (typeof _renderProfileAvatar_ === 'function') _renderProfileAvatar_((currentUser && currentUser.fullName) || '');
    if (typeof _renderHeaderAvatar_ === 'function') _renderHeaderAvatar_();
    _saveAvatarToServer_(dataUrl);
  }).catch(function(){ if (typeof showToast === 'function') showToast('Gagal memproses gambar', 'error'); });
}

// Resize ke kotak (center-crop) + JPEG; turunkan kualitas/ukuran sampai < ~40k char
function _compressAvatar_(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){
      var img = new Image();
      img.onload = function(){
        try {
          function render(size, q){
            var c = document.createElement('canvas');
            c.width = size; c.height = size;
            var ctx = c.getContext('2d');
            var min = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
            return c.toDataURL('image/jpeg', q);
          }
          var out = render(128, 0.6), q = 0.6;
          while (out.length > 40000 && q > 0.3) { q -= 0.1; out = render(128, q); }
          if (out.length > 40000) out = render(96, 0.5);
          resolve(out);
        } catch (err) { reject(err); }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _saveAvatarToServer_(dataUrl){
  if (!currentUser || !currentUser.email) return;
  gasPost_('saveAvatar', { email: currentUser.email, avatar: dataUrl }).then(function(res){
    if (res && res.ok) {
      if (typeof saveSession === 'function') saveSession(currentUser);
      if (typeof showToast === 'function') showToast('Foto profil disimpan', 'success');
    } else {
      if (typeof showToast === 'function') showToast((res && res.error) || 'Gagal menyimpan foto', 'error');
    }
  }).catch(function(){ if (typeof showToast === 'function') showToast('Gagal menyimpan foto', 'error'); });
}

// ============================================================
// REKONSILIASI IPL (admin) — cocokkan CSV mutasi BCA vs submission
// ============================================================
var reconCsvText = null;

function reconEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function reconRupiah_(n) {
  return 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
}

// Set ikon SVG (gaya Lucide, stroke seragam) — pengganti emoji
var RECON_ICON_PATHS = {
  check:    '<path d="M20 6 9 17l-5-5"/>',
  alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x:        '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  partial:  '<path d="M5 12h14"/>',
  eye:      '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  info:     '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  bell:     '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M3.3 18s2.7-2 2.7-9a6 6 0 0 1 12 0c0 7 2.7 9 2.7 9Z"/>',
  send:     '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>'
};
var RECON_BULAN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
// Spinner + disable seluruh tombol dalam grup (dipakai aksi recon)
function reconBtnSpin_(btn) {
  if (!btn) return;
  btn.disabled = true;
  if (btn.parentElement) Array.prototype.forEach.call(btn.parentElement.querySelectorAll('button'), function (b) { b.disabled = true; });
  btn.innerHTML = '<span class="flex items-center justify-center">' + RECON_SPINNER + '</span>';
}
function reconIcon_(name, cls) {
  return '<svg class="' + (cls || 'w-4 h-4') + '" fill="none" stroke="currentColor" stroke-width="2.2" '
    + 'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">'
    + (RECON_ICON_PATHS[name] || '') + '</svg>';
}
var RECON_SPINNER = '<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.3"/>'
  + '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

function reconOnFile(ev) {
  var file = ev.target.files && ev.target.files[0];
  var nameEl = document.getElementById('reconFileName');
  var btn = document.getElementById('reconRunBtn');
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    reconCsvText = String(reader.result || '');
    if (nameEl) nameEl.textContent = file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
    if (btn) btn.disabled = false;
  };
  reader.onerror = function () {
    if (typeof showToast === 'function') showToast('Gagal membaca file', 'error');
  };
  reader.readAsText(file);
}

function reconRunMatch() {
  if (!currentUser || currentUser.role !== 'admin') {
    if (typeof showToast === 'function') showToast('Khusus admin', 'error');
    return;
  }
  if (!reconCsvText) {
    if (typeof showToast === 'function') showToast('Pilih file CSV dulu', 'error');
    return;
  }
  var btn = document.getElementById('reconRunBtn');
  var autoApply = !!(document.getElementById('reconAutoApply') || {}).checked;
  var oldHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center justify-center gap-2">' + RECON_SPINNER + 'Memproses…</span>';
  }

  gasPost_('reconRun', {
    csv: reconCsvText,
    adminEmail: currentUser.email,
    autoApply: autoApply
  }).then(function (res) {
    if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
    if (!res || !res.ok) {
      if (typeof showToast === 'function') showToast((res && res.error) || 'Gagal memproses', 'error');
      return;
    }
    reconRender_(res);
    if (typeof showToast === 'function') showToast('Selesai: ' + res.summary.auto_verified + ' auto, ' + res.summary.need_review + ' review', 'success');
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
    if (typeof showToast === 'function') showToast('Error: ' + (e && e.message || e), 'error');
  });
}

// Chips penjelas skor: ✓ cocok (hijau), ≈ mirip/sebagian (kuning), ✕ tidak (abu)
function reconBreakdownHtml_(b) {
  b = b || {};
  var items = [
    { l: 'Nama', p: b.nama || 0, max: 35 },
    { l: 'Nominal', p: b.nominal || 0, max: 30 },
    { l: 'Blok', p: b.blok || 0, max: 25 },
    { l: 'Periode', p: b.periode || 0, max: 10 }
  ];
  return '<div class="flex flex-wrap gap-1 mt-1.5">' + items.map(function (it) {
    var full = it.p >= it.max, partial = it.p > 0 && it.p < it.max;
    var cls = full ? 'bg-blue-50 text-blue-600' : (partial ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400');
    var icon = reconIcon_(full ? 'check' : (partial ? 'partial' : 'x'), 'w-3 h-3');
    return '<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium ' + cls + '">' + icon + it.l + ' ' + it.p + '/' + it.max + '</span>';
  }).join('') + '</div>';
}

// Ringkasan alasan satu baris, bahasa awam
function reconReason_(b) {
  b = b || {};
  var p = [];
  p.push((b.nama || 0) >= 28 ? 'nama cocok' : ((b.nama || 0) > 0 ? 'nama mirip' : 'nama beda'));
  p.push((b.nominal || 0) >= 30 ? 'nominal sama' : ((b.nominal || 0) > 0 ? 'nominal kelipatan (multi-unit)' : 'nominal beda'));
  p.push((b.blok || 0) > 0 ? 'blok cocok' : 'blok tak terdeteksi di mutasi');
  p.push((b.periode || 0) > 0 ? 'periode cocok' : 'periode tak terdeteksi');
  return p.join(' · ');
}

function reconRender_(res) {
  var sum = res.summary || {};
  window._reconPNS = res.paidNotSubmitted || []; // simpan utk aksi per-index
  document.getElementById('reconSummary').classList.remove('hidden');
  document.getElementById('reconCountAuto').textContent = sum.auto_verified || 0;
  document.getElementById('reconCountReview').textContent = sum.need_review || 0;
  document.getElementById('reconCountUnmatched').textContent = sum.unmatched || 0;
  var pnsEl = document.getElementById('reconCountPns');
  if (pnsEl) pnsEl.textContent = sum.paid_not_submitted || 0;

  var html = '';

  // === AUTO-VERIFIED ===
  if (res.auto && res.auto.length) {
    html += '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">';
    html += '<div class="px-4 py-2.5 border-b border-gray-50 text-xs font-bold text-blue-600 flex items-center gap-1.5">' + reconIcon_('check', 'w-3.5 h-3.5') + 'Auto-verified (' + res.auto.length + ')</div>';
    res.auto.forEach(function (it) {
      var applied = it.applied;
      var hasBukti = !!it.submission.bukti;
      html += '<div class="px-4 py-2.5 border-b border-gray-50 last:border-0" id="reconRow-' + it.submission.rowNum + '">'
        + '<div class="flex items-center gap-2">'
        + '<div class="flex-1 min-w-0' + (hasBukti ? ' cursor-pointer" data-bukti="' + reconEsc_(it.submission.bukti) + '" onclick="reconOpenBukti_(this.dataset.bukti)' : '') + '">'
        + '<p class="text-sm font-semibold text-gray-900 truncate">' + reconEsc_(it.submission.nama) + ' · ' + reconEsc_(it.submission.blok) + (hasBukti ? ' <span class="inline-flex items-center gap-0.5 align-middle text-[10px] text-blue-500 font-normal">' + reconIcon_('eye', 'w-3 h-3') + 'bukti</span>' : '') + '</p>'
        + '<p class="text-xs text-gray-400 truncate">' + reconEsc_(it.mutasi.nama_pengirim) + ' · ' + reconRupiah_(it.mutasi.nominal) + ' · ' + reconEsc_(it.mutasi.tanggal) + '</p>'
        + '</div>'
        + '<span class="text-sm font-bold text-blue-600 flex-shrink-0">' + it.score + '</span>'
        + '</div>'
        + reconBreakdownHtml_(it.breakdown)
        + (applied
            ? '<div class="flex items-center gap-1 mt-2 text-xs text-blue-600 font-semibold">' + reconIcon_('check', 'w-3.5 h-3.5') + 'Terkonfirmasi otomatis</div>'
            : '<div class="flex gap-2 mt-2">'
                + '<button onclick="reconReject(' + it.submission.rowNum + ', this)" class="flex-1 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold active:scale-95 transition">Bukan / Tolak</button>'
                + '<button onclick="reconConfirm(' + it.submission.rowNum + ', this)" class="flex-1 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold active:scale-95 transition">Konfirmasi</button>'
              + '</div>')
        + '</div>';
    });
    html += '</div>';
  }

  // === NEED REVIEW ===
  if (res.review && res.review.length) {
    html += '<div class="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">';
    html += '<div class="px-4 py-2.5 border-b border-gray-50 text-xs font-bold text-amber-600 flex items-center gap-1.5">' + reconIcon_('alert', 'w-3.5 h-3.5') + 'Perlu Review (' + res.review.length + ')</div>';
    res.review.forEach(function (it) {
      var b = it.breakdown || {};
      html += '<div class="px-4 py-3 border-b border-gray-50 last:border-0" id="reconRow-' + it.submission.rowNum + '">'
        + '<div class="flex items-start gap-2">'
        + '<div class="flex-1 grid grid-cols-2 gap-2 text-xs">'
        + '<div class="bg-gray-50 rounded-lg p-2' + (it.submission.bukti ? ' cursor-pointer" data-bukti="' + reconEsc_(it.submission.bukti) + '" onclick="reconOpenBukti_(this.dataset.bukti)' : '') + '">'
        + '<p class="text-[10px] text-gray-400 font-semibold mb-0.5 flex items-center gap-1">SUBMISSION' + (it.submission.bukti ? '<span class="inline-flex items-center gap-0.5 text-blue-500">· ' + reconIcon_('eye', 'w-3 h-3') + 'bukti</span>' : '') + '</p>'
        + '<p class="font-semibold text-gray-800">' + reconEsc_(it.submission.nama) + '</p>'
        + '<p class="text-gray-500">' + reconEsc_(it.submission.blok) + ' · ' + reconEsc_(it.submission.bulan) + ' ' + reconEsc_(it.submission.tahun) + '</p>'
        + '<p class="text-gray-500">' + reconRupiah_(it.submission.nominal) + '</p></div>'
        + '<div class="bg-blue-50 rounded-lg p-2"><p class="text-[10px] text-blue-400 font-semibold mb-0.5">MUTASI BANK</p>'
        + '<p class="font-semibold text-gray-800">' + reconEsc_(it.mutasi.nama_pengirim) + '</p>'
        + '<p class="text-gray-500">' + reconEsc_((it.mutasi.bloks || []).join(',') || '–') + ' · ' + reconEsc_(it.mutasi.tanggal) + '</p>'
        + '<p class="text-gray-500">' + reconRupiah_(it.mutasi.nominal) + '</p></div>'
        + '</div>'
        + '<span class="text-sm font-bold text-amber-600 flex-shrink-0">' + it.score + '</span>'
        + '</div>'
        + reconBreakdownHtml_(b)
        + '<p class="text-[10px] text-gray-400 mt-1">' + reconReason_(b) + '</p>'
        + '<div class="flex gap-2 mt-2">'
        + '<button onclick="reconReject(' + it.submission.rowNum + ', this)" class="flex-1 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold active:scale-95 transition">Bukan / Tolak</button>'
        + '<button onclick="reconConfirm(' + it.submission.rowNum + ', this)" class="flex-1 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold active:scale-95 transition">Konfirmasi</button>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
  }

  // === SUDAH BAYAR, BELUM SUBMIT ===
  if (res.paidNotSubmitted && res.paidNotSubmitted.length) {
    html += '<div class="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">';
    html += '<div class="px-4 py-2.5 border-b border-gray-50 text-xs font-bold text-indigo-600 flex items-center gap-1.5">' + reconIcon_('info', 'w-3.5 h-3.5') + 'Sudah bayar, belum submit (' + res.paidNotSubmitted.length + ')</div>';
    res.paidNotSubmitted.forEach(function (it, i) {
      var adaPeriode = it.mutasi.periode != null;
      html += '<div class="px-4 py-3 border-b border-gray-50 last:border-0" id="reconPns-' + i + '">'
        + '<div class="flex items-start gap-2">'
        + '<div class="flex-1 min-w-0">'
        + '<p class="text-sm font-semibold text-gray-900 truncate">' + reconEsc_(it.warga.nama) + ' · ' + reconEsc_(it.warga.blok)
        + (it.matchedBy === 'blok'
            ? ' <span class="inline-flex items-center gap-0.5 align-middle text-[10px] text-blue-600 font-normal">' + reconIcon_('check', 'w-3 h-3') + 'via blok</span>'
            : ' <span class="inline-flex items-center gap-0.5 align-middle text-[10px] text-amber-600 font-normal">' + reconIcon_('alert', 'w-3 h-3') + 'via nama ' + (it.skorNama || 0) + '%</span>')
        + '</p>'
        + '<p class="text-xs text-gray-400 truncate">Pengirim: ' + reconEsc_(it.mutasi.nama_pengirim) + ' · ' + reconRupiah_(it.mutasi.nominal) + '</p>'
        + '<p class="text-[11px] text-gray-400">' + reconEsc_(it.mutasi.tanggal) + (adaPeriode ? ' · periode ' + RECON_BULAN[it.mutasi.periode] + ' ' + it.mutasi.tahun : ' · periode tak terdeteksi') + (it.warga.noHp ? ' · HP ' + reconEsc_(it.warga.noHp) : ' · HP kosong') + '</p>'
        + '</div></div>'
        + '<div class="flex gap-2 mt-2">'
        + '<button onclick="reconRemindWAByIdx_(' + i + ', this)"' + (it.warga.noHp ? '' : ' disabled')
        + ' class="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold active:scale-95 transition disabled:opacity-40">' + reconIcon_('bell', 'w-3.5 h-3.5') + 'Reminder WA</button>'
        + '<button onclick="reconConfirmUnsubByIdx_(' + i + ', this)"' + (adaPeriode ? '' : ' disabled')
        + ' class="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold active:scale-95 transition disabled:opacity-40">' + reconIcon_('check', 'w-3.5 h-3.5') + 'Konfirmasi</button>'
        + '</div>'
        + (adaPeriode ? '' : '<p class="text-[10px] text-gray-400 mt-1">Periode tak terdeteksi di mutasi — pakai Reminder WA agar warga submit sendiri.</p>')
        + '</div>';
    });
    html += '</div>';
  }

  // === UNMATCHED ===
  if (res.unmatched && res.unmatched.length) {
    html += '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">';
    html += '<div class="px-4 py-2.5 border-b border-gray-50 text-xs font-bold text-gray-500 flex items-center gap-1.5">' + reconIcon_('x', 'w-3.5 h-3.5') + 'Tidak teridentifikasi (' + res.unmatched.length + ')</div>';
    res.unmatched.forEach(function (it) {
      html += '<div class="px-4 py-2.5 border-b border-gray-50 last:border-0 flex items-center gap-2">'
        + '<div class="flex-1 min-w-0">'
        + '<p class="text-sm font-medium text-gray-700 truncate">' + reconEsc_(it.mutasi.nama_pengirim) + '</p>'
        + '<p class="text-xs text-gray-400 truncate">' + reconRupiah_(it.mutasi.nominal) + ' · ' + reconEsc_(it.mutasi.tanggal) + ' · ' + reconEsc_((it.mutasi.bloks||[]).join(',') || 'tanpa blok') + '</p>'
        + '</div>'
        + '<span class="text-[10px] text-gray-300">' + it.score + '</span>'
        + '</div>';
    });
    html += '</div>';
  }

  if (!html) html = '<p class="text-xs text-gray-400 text-center py-6">Tidak ada transaksi CR untuk diproses.</p>';
  document.getElementById('reconResults').innerHTML = html;
}

function reconConfirm(rowNumber, btn) {
  if (!currentUser || currentUser.role !== 'admin') return;
  if (btn) {
    btn.disabled = true;
    if (btn.parentElement) Array.prototype.forEach.call(btn.parentElement.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.innerHTML = '<span class="flex items-center justify-center">' + RECON_SPINNER + '</span>';
  }
  gasPost_('confirmPayment', {
    rowNumber: rowNumber, adminEmail: currentUser.email, note: 'Rekonsiliasi — review manual'
  }).then(function (res) {
    if (res && res.success) {
      var row = document.getElementById('reconRow-' + rowNumber);
      if (row) { row.style.opacity = '0.5'; row.innerHTML = '<p class="text-xs text-blue-600 font-semibold py-1 flex items-center gap-1">' + reconIcon_('check', 'w-3.5 h-3.5') + 'Dikonfirmasi</p>'; }
      if (typeof showToast === 'function') showToast('Pembayaran dikonfirmasi', 'success');
    } else {
      reconResetBtns_(btn, 'Konfirmasi');
      if (typeof showToast === 'function') showToast((res && res.message) || 'Gagal', 'error');
    }
  }).catch(function () {
    reconResetBtns_(btn, 'Konfirmasi');
    if (typeof showToast === 'function') showToast('Error koneksi', 'error');
  });
}

// Kembalikan tombol konfirmasi/tolak ke kondisi semula saat gagal
function reconResetBtns_(btn, label) {
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = label;
  if (btn.parentElement) Array.prototype.forEach.call(btn.parentElement.querySelectorAll('button'), function (b) { b.disabled = false; });
}

function reconReject(rowNumber, btn) {
  if (!currentUser || currentUser.role !== 'admin') return;
  if (btn) {
    btn.disabled = true;
    if (btn.parentElement) Array.prototype.forEach.call(btn.parentElement.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.innerHTML = '<span class="flex items-center justify-center">' + RECON_SPINNER + '</span>';
  }
  gasPost_('rejectPayment', {
    rowNumber: rowNumber, adminEmail: currentUser.email, alasan: 'Rekonsiliasi — bukan match'
  }).then(function (res) {
    if (res && res.success) {
      var row = document.getElementById('reconRow-' + rowNumber);
      if (row) { row.style.opacity = '0.5'; row.innerHTML = '<p class="text-xs text-gray-400 font-semibold py-1 flex items-center gap-1">' + reconIcon_('x', 'w-3.5 h-3.5') + 'Ditolak</p>'; }
      if (typeof showToast === 'function') showToast('Submission ditolak', 'success');
    } else {
      reconResetBtns_(btn, 'Bukan / Tolak');
      if (typeof showToast === 'function') showToast((res && res.message) || 'Gagal', 'error');
    }
  }).catch(function () {
    reconResetBtns_(btn, 'Bukan / Tolak');
    if (typeof showToast === 'function') showToast('Error koneksi', 'error');
  });
}

// Buka preview bukti bayar submission (pakai modal openBuktiViewer yg sudah ada)
function reconOpenBukti_(url) {
  if (!url) {
    if (typeof showToast === 'function') showToast('Submission ini tidak punya bukti', 'error');
    return;
  }
  if (typeof openBuktiViewer === 'function') {
    openBuktiViewer(url);
  } else if (typeof window.openBuktiViewer === 'function') {
    window.openBuktiViewer(url);
  } else {
    window.open(url, '_blank'); // fallback
  }
}

// Kirim reminder WA ke warga "sudah bayar belum submit"
function reconRemindWAByIdx_(i, btn) {
  var it = (window._reconPNS || [])[i];
  if (!it) return;
  if (!currentUser || currentUser.role !== 'admin') { if (typeof showToast === 'function') showToast('Khusus admin', 'error'); return; }
  if (!it.warga.noHp) { if (typeof showToast === 'function') showToast('No HP warga kosong', 'error'); return; }
  reconBtnSpin_(btn);
  var periodeTxt = it.mutasi.periode != null ? (RECON_BULAN[it.mutasi.periode] + ' ' + it.mutasi.tahun) : '';
  gasPost_('reconRemindWA', {
    noHp: it.warga.noHp, nama: it.warga.nama, blok: it.warga.blok,
    nominal: it.mutasi.nominal, periode: periodeTxt
  }).then(function (res) {
    if (res && res.ok) {
      if (btn) { btn.innerHTML = reconIcon_('check', 'w-3.5 h-3.5') + 'Terkirim'; btn.classList.add('opacity-60'); }
      if (typeof showToast === 'function') showToast('Reminder WA terkirim ke ' + it.warga.nama, 'success');
    } else {
      reconResetBtns_(btn, 'Reminder WA');
      if (typeof showToast === 'function') showToast((res && res.error) || 'Gagal kirim WA', 'error');
    }
  }).catch(function () {
    reconResetBtns_(btn, 'Reminder WA');
    if (typeof showToast === 'function') showToast('Error koneksi', 'error');
  });
}

// Konfirmasi langsung pembayaran warga yang belum submit (buat row form + confirm)
function reconConfirmUnsubByIdx_(i, btn) {
  var it = (window._reconPNS || [])[i];
  if (!it) return;
  if (!currentUser || currentUser.role !== 'admin') { if (typeof showToast === 'function') showToast('Khusus admin', 'error'); return; }
  if (it.mutasi.periode == null) { if (typeof showToast === 'function') showToast('Periode tak terdeteksi, gunakan Reminder WA', 'error'); return; }
  reconBtnSpin_(btn);
  gasPost_('reconConfirmUnsubmitted', {
    adminEmail: currentUser.email, email: it.warga.email, nama: it.warga.nama, noHp: it.warga.noHp,
    blok: it.warga.blok, nominal: it.mutasi.nominal, bulanIdx: it.mutasi.periode - 1, tahun: it.mutasi.tahun
  }).then(function (res) {
    if (res && res.ok) {
      var row = document.getElementById('reconPns-' + i);
      if (row) { row.style.opacity = '0.5'; row.innerHTML = '<p class="text-xs text-blue-600 font-semibold py-1 flex items-center gap-1">' + reconIcon_('check', 'w-3.5 h-3.5') + 'Dikonfirmasi & diposting</p>'; }
      if (typeof showToast === 'function') showToast('Pembayaran ' + it.warga.nama + ' dikonfirmasi', 'success');
    } else {
      reconResetBtns_(btn, 'Konfirmasi');
      if (typeof showToast === 'function') showToast((res && res.error || res && res.message) || 'Gagal', 'error');
    }
  }).catch(function () {
    reconResetBtns_(btn, 'Konfirmasi');
    if (typeof showToast === 'function') showToast('Error koneksi', 'error');
  });
}
