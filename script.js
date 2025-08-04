// script.js

mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null,
    true
);

mapboxgl.accessToken = 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [44.0249, 32.6163], // Karbala
    zoom: 8,
    pitch: 45,
    bearing: -17.6
});

// متغيرات عامة
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {};
const poiMarkers = {};
const meetingPointMarkers = {};
const moazebMarkers = {};
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};
let moazebConnectionLayerId = null;

const socket = io('https://tareeqaljannah-app.onrender.com');

// --- وظائف الواجهة الرسومية ---
function togglePanel(panelId) {
    document.querySelectorAll('.overlay-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.main-header nav button').forEach(btn => btn.classList.remove('active'));
    if (panelId) {
        document.getElementById(panelId)?.classList.add('active');
        const activeBtn = document.querySelector(`button[onclick*="'${panelId}'"]`);
        if (activeBtn) activeBtn.classList.add('active');
    }
}

document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.querySelectorAll('.main-header nav button').forEach(btn => btn.classList.remove('active'));
    });
});

// --- وظائف الخريطة والعلامات ---
function createCustomMarker(user) {
    if (!user || !user.location?.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
        return null;
    }

    if (friendMarkers[user.userId]) {
        friendMarkers[user.userId].remove();
    }

    const el = document.createElement('div');
    el.className = 'mapboxgl-marker';
    el.classList.add(currentUser && user.userId === currentUser.userId ? 'current-user-marker' : 'friend-marker');
    if (currentUser && user.userId === currentUser.userId && currentUser.settings.stealthMode) {
        el.classList.add('stealth-mode');
    }

    const userPhotoSrc = user.photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER';
    el.innerHTML = `
        <img class="user-marker-photo" src="${userPhotoSrc}" alt="${user.name}">
        <div class="user-marker-name">${user.name}</div>
        <div class="message-bubble" id="msg-bubble-${user.userId}"></div>
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(user.location.coordinates)
        .addTo(map);

    if (currentUser && user.userId !== currentUser.userId) {
        marker.getElement().addEventListener('click', () => showFriendDetailsPopup(user));
    }
    
    friendMarkers[user.userId] = marker;
    return marker;
}

function updateMarkerPosition(user) {
    if (!user || !user.location?.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
        return;
    }

    if (friendMarkers[user.userId]) {
        friendMarkers[user.userId].setLngLat(user.location.coordinates);
    } else {
        createCustomMarker(user);
    }
}

function showFriendDetailsPopup(friend) {
    friendMarkers[friend.userId]?._popup?.remove();
    
    const distance = (currentUser?.location?.coordinates && friend.location?.coordinates)
        ? calculateDistance(...currentUser.location.coordinates.reverse(), ...friend.location.coordinates.reverse()).toFixed(2) + " كم"
        : "موقع غير محدد";

    const popupContent = `
        <h3>${friend.name}</h3>
        <p><i class="fas fa-battery-full"></i> البطارية: ${friend.batteryStatus || 'N/A'}</p>
        <p><i class="fas fa-route"></i> المسافة عنك: ${distance}</p>
        <p><i class="fas fa-clock"></i> آخر ظهور: ${new Date(friend.lastSeen).toLocaleTimeString()}</p>
        ${friend.gender !== 'other' ? `<p><i class="fas fa-venus-mars"></i> الجنس: ${friend.gender === 'male' ? 'ذكر' : 'أنثى'}</p>` : ''}
        ${friend.phone && friend.settings.showPhone ? `<p><i class="fas fa-phone"></i> الهاتف: ${friend.phone}</p>` : ''}
        ${friend.email && friend.settings.showEmail ? `<p><i class="fas fa-envelope"></i> البريد: ${friend.email}</p>` : ''}
        <div style="display: flex; justify-content: space-around; margin-top: 10px;">
            <button onclick="unfriendUser('${friend.userId}', '${friend.name}')" class="popup-btn danger-btn"><i class="fas fa-user-minus"></i></button>
            <button onclick="startChat('${friend.userId}')" class="popup-btn primary-btn"><i class="fas fa-comments"></i></button>
        </div>
    `;

    new mapboxgl.Popup({ offset: 25 })
        .setLngLat(friend.location.coordinates)
        .setHTML(popupContent)
        .addTo(map);
}

window.unfriendUser = (friendId, friendName) => {
    if (confirm(`هل أنت متأكد أنك تريد إلغاء الارتباط بـ ${friendName}؟`)) {
        socket.emit('unfriendUser', { friendId });
    }
};

window.startChat = (friendId) => {
    currentChatFriendId = friendId;
    setupBottomChatBar();
    document.getElementById('bottomChatBar').classList.add('active');
    document.querySelector('.mapboxgl-popup')?.remove();
};


function createPOIMarker(poi) {
    if (!poi?.location?.coordinates) return null;
    poiMarkers[poi._id]?.remove();
    
    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <h3>${poi.name}</h3>
        <p>${poi.description || 'لا يوجد وصف'}</p>
        <p><strong>الفئة:</strong> ${poi.category}</p>
        ${currentUser && poi.createdBy === currentUser.userId ? 
            `<button class="popup-btn danger-btn" onclick="deletePOI('${poi._id}', '${poi.name}')">
                <i class="fas fa-trash"></i> حذف
            </button>` : ''}
    `);
    
    poiMarkers[poi._id] = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(popup)
        .addTo(map);
}

window.deletePOI = (poiId, poiName) => {
     if (confirm(`هل أنت متأكد أنك تريد حذف نقطة الاهتمام "${poiName}"؟`)) {
        socket.emit('deletePOI', { poiId });
    }
}

function createMoazebMarker(moazeb) {
    if (!moazeb?.location?.coordinates) return;
    moazebMarkers[moazeb._id]?.remove();

    const el = document.createElement('div');
    el.className = 'moazeb-marker';
    const iconClass = {
        'mawkib': 'fas fa-flag', 'hussainiya': 'fas fa-place-of-worship', 'tent': 'fas fa-campground',
        'station': 'fas fa-gas-pump', 'sleep': 'fas fa-bed', 'food': 'fas fa-utensils'
    }[moazeb.type] || 'fas fa-home';
    el.innerHTML = `<i class="${iconClass}"></i>`;

    const popupHTML = `
        <h3>${moazeb.name}</h3>
        <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
        <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
        <p><i class="fas fa-city"></i> ${moazeb.governorate} - ${moazeb.district}</p>
        <button class="popup-btn primary-btn" onclick="linkToMoazeb('${moazeb._id}', '${moazeb.name}')">
            <i class="fas fa-link"></i> ربط
        </button>
        ${currentUser?.linkedMoazeb?.moazebId === moazeb._id ? 
            `<button class="popup-btn danger-btn" onclick="unlinkFromMoazeb()">
                <i class="fas fa-unlink"></i> إلغاء الربط
            </button>` : ''}
    `;
    
    moazebMarkers[moazeb._id] = new mapboxgl.Marker(el)
        .setLngLat(moazeb.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(popupHTML))
        .addTo(map);
}

window.linkToMoazeb = (moazebId, moazebName) => {
    if (confirm(`هل تريد الربط مع المضيف ${moazebName}؟`)) {
        socket.emit('linkToMoazeb', { moazebId });
    }
};

window.unlinkFromMoazeb = () => {
    if (confirm(`هل تريد إلغاء الربط مع المضيف الحالي؟`)) {
        socket.emit('unlinkFromMoazeb');
    }
};


function drawMoazebConnectionLine(connectionLine) {
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
    }
    if (!connectionLine || connectionLine.length < 2) return;

    moazebConnectionLayerId = 'moazeb-connection-' + Date.now();
    map.addSource(moazebConnectionLayerId, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: connectionLine } }
    });
    map.addLayer({
        id: moazebConnectionLayerId, type: 'line', source: moazebConnectionLayerId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FFA500', 'line-width': 4, 'line-dasharray': [2, 2] }
    });
}

// --- وظائف عرض الخرائط المختلفة ---
function showGeneralMap() {
    Object.values(friendMarkers).forEach(m => m.remove());
    Object.keys(friendMarkers).forEach(k => delete friendMarkers[k]);
    socket.emit('requestPOIs');
    map.flyTo({ center: [44.0249, 32.6163], zoom: 8, pitch: 45, bearing: -17.6 });
}

function showFriendsMap() {
    Object.values(poiMarkers).forEach(m => m.remove());
    Object.keys(poiMarkers).forEach(k => delete poiMarkers[k]);

    if (currentUser?.settings.shareLocation && !currentUser.settings.stealthMode) {
        updateMarkerPosition(currentUser);
    }
    linkedFriends.forEach(friend => {
        if (friend.settings.shareLocation && !friend.settings.stealthMode) {
            updateMarkerPosition(friend);
        }
    });

    const allVisibleCoords = [currentUser, ...linkedFriends]
        .filter(u => u?.location?.coordinates && u.settings.shareLocation && !u.settings.stealthMode && (u.location.coordinates[0] !== 0 || u.location.coordinates[1] !== 0))
        .map(u => u.location.coordinates);

    if (allVisibleCoords.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        allVisibleCoords.forEach(coord => bounds.extend(coord));
        map.fitBounds(bounds, { padding: 80, pitch: 45, bearing: -17.6 });
    } else if (allVisibleCoords.length === 1) {
        map.flyTo({ center: allVisibleCoords[0], zoom: 14, pitch: 45, bearing: -17.6 });
    }
}

// --- نظام تحديد المواقع (GPS) والبطارية ---
function startLocationTracking() {
    if (!navigator.geolocation) return alert("متصفحك لا يدعم تحديد المواقع.");
    if (!currentUser) return;
    navigator.geolocation.watchPosition(
        async (position) => {
            socket.emit('updateLocation', {
                location: [position.coords.longitude, position.coords.latitude],
                battery: await getBatteryStatus()
            });
        },
        (error) => console.error("خطأ في تحديد الموقع:", error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function getBatteryStatus() {
    if (!('getBattery' in navigator)) return 'N/A';
    try {
        const battery = await navigator.getBattery();
        return `${(battery.level * 100).toFixed(0)}%`;
    } catch (e) { return 'N/A'; }
}

// --- نظام الدردشة والاشعارات ---
function playNotificationSound() {
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(e => {});
}

function showMessageBubble(userId, messageText) {
    const bubble = document.getElementById(`msg-bubble-${userId}`);
    if (bubble && !currentUser.settings.hideBubbles) {
        clearTimeout(activeMessageTimers[userId]);
        bubble.textContent = messageText;
        bubble.classList.add('show');
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 30000);
    }
}

function addChatMessage(senderName, messageText, type = '', timestamp = new Date()) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    const timeString = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<span class="message-meta">${senderName} - ${timeString}</span><br>${messageText}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessageFromBottomBar() {
    const messageText = document.getElementById('bottomChatInput').value.trim();
    if (!currentUser || !currentChatFriendId || !messageText) return;

    if (document.getElementById('chatPanel').classList.contains('active')) {
         addChatMessage("أنا", messageText, 'sent');
    }
    socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });
    playNotificationSound();
    showMessageBubble(currentUser.userId, messageText);
    document.getElementById('bottomChatInput').value = '';
}

function setupChatPanel() {
    const chatFriendSelect = document.getElementById('chatFriendSelect');
    chatFriendSelect.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            chatFriendSelect.appendChild(option);
        });
        currentChatFriendId = document.getElementById('bottomChatFriendSelect').value || linkedFriends[0].userId;
        chatFriendSelect.value = currentChatFriendId;
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        currentChatFriendId = null;
        document.getElementById('chatMessages').innerHTML = '<p class="feature-info">لا يوجد أصدقاء للدردشة.</p>';
    }
}

function setupBottomChatBar() {
    const bottomChatBar = document.getElementById('bottomChatBar');
    const bottomChatFriendSelect = document.getElementById('bottomChatFriendSelect');
    bottomChatFriendSelect.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            bottomChatFriendSelect.appendChild(option);
        });
        currentChatFriendId = currentChatFriendId && linkedFriends.some(f => f.userId === currentChatFriendId) ? currentChatFriendId : linkedFriends[0].userId;
        bottomChatFriendSelect.value = currentChatFriendId;
        bottomChatBar.classList.add('active');
    } else {
        bottomChatBar.classList.remove('active');
        currentChatFriendId = null;
    }
}

// --- تحديث الواجهة بالبيانات ---
function updateUIWithUserData() {
    if (!currentUser) return;
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userPhoto').src = currentUser.photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER';
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    document.getElementById('editUserNameInput').value = currentUser.name;
    document.getElementById('editGenderSelect').value = currentUser.gender || 'other';
    document.getElementById('editPhoneInput').value = currentUser.phone || '';
    document.getElementById('editEmailInput').value = currentUser.email || '';
    document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
    document.getElementById('soundToggle').checked = currentUser.settings.sound;
    document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;
    document.getElementById('showPhoneToggle').checked = currentUser.settings.showPhone;
    document.getElementById('showEmailToggle').checked = currentUser.settings.showEmail;
    document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';
}

function updateMyCreationsList() {
    const poisListContainer = document.getElementById('userPOIsList');
    if (!poisListContainer || !currentUser?.createdPOIs) return;
    
    poisListContainer.innerHTML = '';
    if (currentUser.createdPOIs.length > 0) {
        currentUser.createdPOIs.forEach(poi => {
            const poiLi = document.createElement('li');
            poiLi.innerHTML = `${poi.name} (${poi.category}) 
                <button class="delete-poi-btn-small" onclick="deletePOI('${poi._id}', '${poi.name}')">
                    <i class="fas fa-trash"></i>
                </button>`;
            poisListContainer.appendChild(poiLi);
        });
    } else {
        poisListContainer.innerHTML = '<p class="feature-info">لم تقم بإضافة أي نقاط.</p>';
    }
}

// --- معالجات أحداث Socket.IO ---
socket.on('connect', () => console.log('✅ متصل بالخادم.'));

socket.on('auth:error', (message) => {
    alert(`خطأ: ${message}`);
    document.querySelector('#login-overlay button:not([disabled])')?.removeAttribute('disabled');
});

socket.on('auth:show_verify', ({ phone }) => {
    document.getElementById('register-form-container').style.display = 'none';
    document.getElementById('verify-form-container').style.display = 'block';
    document.getElementById('verify-phone-display').textContent = phone;
    localStorage.setItem('appUserPhone', phone);
});

socket.on('auth:login_success', (user) => {
    currentUser = user;
    localStorage.setItem('appUserPhone', currentUser.phone);
    
    document.getElementById('login-overlay').style.display = 'none';
    document.querySelector('main').style.display = 'block';

    socket.emit('user:initialize_session', { userId: currentUser.userId });

    if (!currentUser.name.startsWith('زائر_') && currentUser.email) {
        document.getElementById('initialInfoPanel').classList.remove('active');
    } else {
        document.getElementById('initialInfoPanel').classList.add('active');
        document.getElementById('initialInfoNameInput').value = currentUser.name.startsWith('زائر_') ? '' : currentUser.name;
        document.getElementById('initialInfoGenderSelect').value = currentUser.gender || 'other';
        document.getElementById('initialInfoPhoneInput').value = currentUser.phone || '';
        document.getElementById('initialInfoEmailInput').value = currentUser.email || '';
    }
});

socket.on('user:session_initialized', (user) => {
    currentUser = user;
    console.log('تم تهيئة الجلسة:', currentUser);
    updateUIWithUserData();
    updateMyCreationsList();
    startLocationTracking();
    if (currentUser.linkedFriends?.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
});

socket.on('user:settings_updated', (user) => {
    currentUser = user;
    alert('تم تحديث الإعدادات بنجاح!');
    updateUIWithUserData();
});

socket.on('locationUpdate', (data) => {
    if (currentUser && data.userId === currentUser.userId) {
        currentUser.location = { coordinates: data.location };
        Object.assign(currentUser, data);
        updateMarkerPosition(currentUser);
    } else {
        const friend = linkedFriends.find(f => f.userId === data.userId);
        if (friend) {
            friend.location = { coordinates: data.location };
            Object.assign(friend, data);
            if (friend.settings.shareLocation && !friend.settings.stealthMode) {
                 updateMarkerPosition(friend);
            } else {
                if(friendMarkers[friend.userId]) {
                    friendMarkers[friend.userId].remove();
                    delete friendMarkers[friend.userId];
                }
            }
        }
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
        showFriendsMap();
    }
    setupBottomChatBar();
    
    const friendsListEl = document.getElementById('friendsList');
    friendsListEl.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const li = document.createElement('li');
            li.innerHTML = `<img src="${friend.photo}" class="friend-list-photo"> <span>${friend.name}</span> <span class="friend-list-battery">${friend.batteryStatus || 'N/A'}</span> <button class="unfriend-in-list-btn" onclick="unfriendUser('${friend.userId}', '${friend.name}')"><i class="fas fa-user-minus"></i></button>`;
            friendsListEl.appendChild(li);
        });
    } else {
        friendsListEl.innerHTML = '<li class="feature-info">لا يوجد أصدقاء مرتبطون.</li>';
    }
});

socket.on('newChatMessage', (data) => {
    if (currentUser?.userId === data.receiverId) {
        showMessageBubble(data.senderId, data.message);
        playNotificationSound();
        if (data.senderId === currentChatFriendId && document.getElementById('chatPanel').classList.contains('active')) {
            addChatMessage(data.senderName, data.message, 'received', data.timestamp);
        }
    }
});

socket.on('updatePOIsList', (poisData) => {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    poisData.forEach(poi => createPOIMarker(poi));
});

socket.on('linkStatus', (data) => {
    alert(data.message);
    if(data.success) togglePanel(null);
});
socket.on('unfriendStatus', (data) => alert(data.message));
socket.on('poiStatus', (data) => alert(data.message));
socket.on('poiDeleted', (data) => {
    if (data.success) {
        poiMarkers[data.poiId]?.remove();
        delete poiMarkers[data.poiId];
    }
    alert(data.message);
});

socket.on('moazebConnectionData', (data) => {
    if (data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine);
});
socket.on('moazebConnectionUpdate', (data) => {
    if (data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine);
});
socket.on('moazebConnectionRemoved', () => {
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
        moazebConnectionLayerId = null;
    }
});
socket.on('linkToMoazebStatus', (data) => {
    alert(data.message);
    if (data.success && data.connectionLine?.length > 0) {
        drawMoazebConnectionLine(data.connectionLine);
    }
});
socket.on('unlinkFromMoazebStatus', (data) => alert(data.message));
socket.on('moazebSearchResults', (data) => {
    const container = document.getElementById('moazebResultsContainer');
    container.innerHTML = '';
    Object.values(moazebMarkers).forEach(m => m.remove());
    Object.keys(moazebMarkers).forEach(k => delete moazebMarkers[k]);

    if (data.success && data.results.length > 0) {
        data.results.forEach(moazeb => {
            container.innerHTML += `<div class="moazeb-card"><h4>${moazeb.name}</h4><p><i class="fas fa-phone"></i> ${moazeb.phone}</p><p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p></div>`;
            createMoazebMarker(moazeb);
        });
        const bounds = new mapboxgl.LngLatBounds();
        data.results.forEach(m => bounds.extend(m.location.coordinates));
        map.fitBounds(bounds, { padding: 50 });
    } else {
        container.innerHTML = '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>';
    }
});
socket.on('allMoazebData', (data) => {
    if(data.success && data.moazebs) {
        Object.values(moazebMarkers).forEach(m => m.remove());
        Object.keys(moazebMarkers).forEach(k => delete moazebMarkers[k]);
        data.moazebs.forEach(createMoazebMarker);
        if (data.moazebs.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            data.moazebs.forEach(m => bounds.extend(m.location.coordinates));
            map.fitBounds(bounds, { padding: 50 });
        }
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatMessagesDiv.innerHTML = '';
    if (data.success && data.history?.length > 0) {
        data.history.forEach(msg => {
            const type = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            const name = (type === 'sent') ? "أنا" : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(name, msg.message, type, msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p class="feature-info">لا توجد رسائل سابقة.</p>';
    }
});

// --- معالجات أحداث الصفحة (DOMContentLoaded) ---
document.addEventListener('DOMContentLoaded', () => {
    // --- Auth Form Handling ---
    const phone = localStorage.getItem('appUserPhone');
    if (phone) {
        document.getElementById('login-phone').value = phone;
    }
    
    document.getElementById('show-register-form').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form-container').style.display = 'none';
        document.getElementById('register-form-container').style.display = 'block';
    });
    
    document.getElementById('show-login-form').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form-container').style.display = 'none';
        document.getElementById('login-form-container').style.display = 'block';
    });

    document.getElementById('register-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const phone = document.getElementById('register-phone').value;
        const password = document.getElementById('register-password').value;
        const confirmPass = document.getElementById('register-confirm-password').value;
        if (password !== confirmPass) return alert('كلمتا المرور غير متطابقتين.');
        e.target.querySelector('button').setAttribute('disabled', 'true');
        socket.emit('auth:register', { phone, password });
    });

    document.getElementById('verify-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const phone = localStorage.getItem('appUserPhone');
        const code = document.getElementById('verify-code').value;
        e.target.querySelector('button').setAttribute('disabled', 'true');
        socket.emit('auth:verify', { phone, code });
    });

    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const phone = document.getElementById('login-phone').value;
        const password = document.getElementById('login-password').value;
        e.target.querySelector('button').setAttribute('disabled', 'true');
        socket.emit('auth:login', { phone, password });
    });
    
    // -- Main App Buttons --
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => { togglePanel(null); showGeneralMap(); });
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => { togglePanel(null); showFriendsMap(); });
    document.getElementById('showAllMoazebBtn').addEventListener('click', () => { togglePanel(null); socket.emit('getAllMoazeb'); });
    document.getElementById('showProfileBtn').addEventListener('click', () => togglePanel('profilePanel'));
    document.getElementById('showConnectBtn').addEventListener('click', () => togglePanel('connectPanel'));
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));
    document.getElementById('showFeaturesBtn').addEventListener('click', () => togglePanel('featuresPanel'));
    document.getElementById('showSettingsBtn').addEventListener('click', () => togglePanel('settingsPanel'));
    
    document.getElementById('initialInfoConfirmBtn').addEventListener('click', () => {
        const data = {
            name: document.getElementById('initialInfoNameInput').value.trim(),
            gender: document.getElementById('initialInfoGenderSelect').value,
            phone: document.getElementById('initialInfoPhoneInput').value.trim(),
            email: document.getElementById('initialInfoEmailInput').value.trim()
        };
        if (data.name && data.gender !== 'other' && data.phone && data.email) {
            socket.emit('updateSettings', data);
            document.getElementById('initialInfoPanel').classList.remove('active');
        } else {
            alert('الرجاء ملء جميع الحقول المطلوبة.');
        }
    });

    document.getElementById('updateProfileInfoBtn').addEventListener('click', () => {
        const data = {
            name: document.getElementById('editUserNameInput').value.trim(),
            gender: document.getElementById('editGenderSelect').value,
            phone: document.getElementById('editPhoneInput').value.trim(),
            email: document.getElementById('editEmailInput').value.trim()
        };
        if (data.name && data.gender !== 'other' && data.phone && data.email) {
            socket.emit('updateSettings', data);
        } else {
            alert('الرجاء ملء جميع حقول معلومات الملف الشخصي المطلوبة.');
        }
    });

    document.getElementById('connectFriendBtn').addEventListener('click', () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if (friendCode) socket.emit('requestLink', { friendCode });
    });

    document.getElementById('bottomChatSendBtn').addEventListener('click', sendMessageFromBottomBar);
    document.getElementById('bottomChatInput').addEventListener('keypress', (e) => e.key === 'Enter' && sendMessageFromBottomBar());
    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => { setupChatPanel(); togglePanel('chatPanel'); });
    document.getElementById('chatFriendSelect').addEventListener('change', (e) => {
        currentChatFriendId = e.target.value;
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    });

    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            return alert("موقعك الحالي غير متاح. يرجى تفعيل GPS.");
        }
        const poiName = prompt("أدخل اسم نقطة الاهتمام:");
        if (poiName) {
            const poiDesc = prompt("أدخل وصفاً (اختياري):");
            const poiCategory = document.getElementById('poiCategorySelect').value;
            const iconMap = {'Rest Area': '<i class="fas fa-bed"></i>', 'Medical Post': '<i class="fas fa-medkit"></i>', 'Food Station': '<i class="fas fa-utensils"></i>', 'Water': '<i class="fas fa-tint"></i>', 'Mosque': '<i class="fas fa-mosque"></i>', 'Parking': '<i class="fas fa-parking"></i>', 'Info': '<i class="fas fa-info-circle"></i>', 'Other': '<i class="fas fa-map-marker-alt"></i>'};
            socket.emit('addCommunityPOI', {
                name: poiName, description: poiDesc, category: poiCategory,
                location: currentUser.location.coordinates, icon: iconMap[poiCategory]
            });
        }
    });

    document.getElementById('searchMoazebBtn').addEventListener('click', () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim()
        };
        if (Object.values(query).every(v => !v)) return alert('الرجاء إدخال معيار واحد على الأقل للبحث.');
        socket.emit('searchMoazeb', query);
    });

    document.getElementById('addMoazebBtn').addEventListener('click', () => {
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            return alert("موقعك الحالي غير متاح. يرجى تفعيل GPS.");
        }
        const data = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
            type: document.getElementById('addMoazebType').value,
            location: currentUser.location.coordinates
        };
        if (!data.name || !data.address || !data.phone || !data.governorate || !data.district) {
            return alert('الرجاء ملء جميع حقول المضيف.');
        }
        socket.emit('addMoazeb', data);
    });

    document.getElementById('sosButton').addEventListener('click', () => {
        const emergencyWhatsapp = currentUser?.settings.emergencyWhatsapp;
        if (!emergencyWhatsapp) return alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات أولاً.");
        if (confirm("هل أنت متأكد من إرسال إشارة استغاثة؟")) {
            let message = `مساعدة عاجلة! أنا ${currentUser.name} بحاجة للمساعدة.\n`;
            if (currentUser.location?.coordinates) {
                const [lng, lat] = currentUser.location.coordinates;
                message += `موقعي الحالي: https://www.google.com/maps?q=${lat},${lng}\n`;
            }
            window.open(`https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`, '_blank');
        }
    });

    ['shareLocationToggle', 'soundToggle', 'hideBubblesToggle', 'stealthModeToggle', 'showPhoneToggle', 'showEmailToggle'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            const settings = {};
            settings[id.replace('Toggle', '')] = e.target.checked;
            socket.emit('updateSettings', { settings });
        });
    });
    
    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => {
        const emergencyWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
        if (emergencyWhatsapp) socket.emit('updateSettings', { settings: { emergencyWhatsapp } });
    });

    // --- 3D Map Controls ---
    document.getElementById('pitch-up').addEventListener('click', () => map.setPitch(Math.min(map.getPitch() + 10, 85)));
    document.getElementById('pitch-down').addEventListener('click', () => map.setPitch(Math.max(map.getPitch() - 10, 0)));
    document.getElementById('bearing-left').addEventListener('click', () => map.setBearing(map.getBearing() - 20));
    document.getElementById('bearing-right').addEventListener('click', () => map.setBearing(map.getBearing() + 20));
});

// Helper
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
