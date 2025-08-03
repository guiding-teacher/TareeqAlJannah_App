// script.js

// Ensure Mapbox can handle Right-to-Left text for Arabic
mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null,
    true
);

// ====== Mapbox Configuration ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11', // A standard, clean map style
    center: [44.0249, 32.6163], // Centered on Karbala, Iraq
    zoom: 8,
    pitch: 45,
    bearing: -17.6
});

// ====== Global Variables ======
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {};
const poiMarkers = {};
let meetingPointMarker = null; // To keep track of the meeting point marker
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};

// Socket.IO Connection
// const socket = io('http://localhost:3000'); // For local testing
const socket = io('https://tareeqaljannah-app.onrender.com'); // For deployed version

// ====== UI Helper Functions ======

function togglePanel(panelId) {
    document.querySelectorAll('.overlay-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.querySelectorAll('.main-header nav button').forEach(btn => {
        btn.classList.remove('active');
    });

    if (panelId) {
        const targetPanel = document.getElementById(panelId);
        if (targetPanel) {
            targetPanel.classList.add('active');
            const activeBtn = document.querySelector(`button[id$="${panelId.replace('Panel', 'Btn')}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }
    } else {
        // If no panel is shown, default to the General Map button being active
        document.getElementById('showGeneralMapBtn').classList.add('active');
    }
}

// Attach event listeners to all close buttons
document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        togglePanel(null); // Reset to no active panel
        showGeneralMap();
    });
});

// ====== Map & Location Functions ======

function createCustomMarker(user) {
    if (!user || !user.location || !user.location.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
        return null;
    }
    if (friendMarkers[user.userId]) {
        friendMarkers[user.userId].remove();
    }

    const el = document.createElement('div');
    el.className = 'mapboxgl-marker';
    el.classList.add(currentUser && user.userId === currentUser.userId ? 'current-user-marker' : 'friend-marker');

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
        marker.getElement().addEventListener('click', () => {
            showFriendDetailsPopup(user);
        });
    }

    friendMarkers[user.userId] = marker;
    return marker;
}

function showFriendDetailsPopup(friend) {
    if (friendMarkers[friend.userId]?._popup) {
        friendMarkers[friend.userId]._popup.remove();
    }

    const currentUserHasValidLocation = currentUser?.location?.coordinates && (currentUser.location.coordinates[0] !== 0 || currentUser.location.coordinates[1] !== 0);
    const friendHasValidLocation = friend?.location?.coordinates && (friend.location.coordinates[0] !== 0 || friend.location.coordinates[1] !== 0);

    let distanceHtml = '<p><i class="fas fa-route"></i> المسافة عنك: موقع غير محدد</p>';
    if (currentUserHasValidLocation && friendHasValidLocation) {
        const distance = calculateDistance(
            currentUser.location.coordinates[1], currentUser.location.coordinates[0],
            friend.location.coordinates[1], friend.location.coordinates[0]
        ).toFixed(2);
        distanceHtml = `<p><i class="fas fa-route"></i> المسافة عنك: ${distance} كم</p>`;
    }

    const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).toLocaleString('ar-EG') : 'غير معروف';

    const popupContent = `
        <h3>${friend.name}</h3>
        <p><i class="fas fa-battery-full"></i> البطارية: ${friend.batteryStatus || 'N/A'}</p>
        ${distanceHtml}
        <p><i class="fas fa-clock"></i> آخر ظهور: ${lastSeenTime}</p>
        ${friend.gender && friend.gender !== 'other' ? `<p><i class="fas fa-venus-mars"></i> الجنس: ${friend.gender === 'male' ? 'ذكر' : 'أنثى'}</p>` : ''}
        ${friend.phone ? `<p><i class="fas fa-phone"></i> الهاتف: <a href="tel:${friend.phone}">${friend.phone}</a></p>` : ''}
        ${friend.email ? `<p><i class="fas fa-envelope"></i> البريد: <a href="mailto:${friend.email}">${friend.email}</a></p>` : ''}
        <div style="display: flex; justify-content: space-around; margin-top: 10px;">
            <button onclick="unfriendFromPopup('${friend.userId}', '${friend.name}')" class="unfriend-btn"><i class="fas fa-user-minus"></i> إلغاء الربط</button>
            <button onclick="chatFromPopup('${friend.userId}')" class="chat-friend-btn"><i class="fas fa-comments"></i> دردشة</button>
        </div>
    `;

    const popup = new mapboxgl.Popup({ offset: 25 })
        .setLngLat(friend.location.coordinates)
        .setHTML(popupContent)
        .addTo(map);

    friendMarkers[friend.userId]._popup = popup;
}
// Helper functions for popup buttons to avoid complex event listener management inside strings
function unfriendFromPopup(friendId, friendName) {
    if (confirm(`هل أنت متأكد أنك تريد إلغاء الارتباط بـ ${friendName}؟`)) {
        socket.emit('unfriendUser', { friendId });
        friendMarkers[friendId]?._popup.remove();
    }
}
function chatFromPopup(friendId) {
    currentChatFriendId = friendId;
    setupBottomChatBar();
    document.getElementById('bottomChatBar').classList.add('active');
    friendMarkers[friendId]?._popup.remove();
}


function createPOIMarker(poi) {
    if (!poi?.location?.coordinates) return;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    // Use a default icon if none is provided
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <h3>${poi.name}</h3>
        <p>${poi.description || 'لا يوجد وصف'}</p>
        <p><strong>الفئة:</strong> ${poi.category}</p>
    `);

    poiMarkers[poi._id] = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(popup)
        .addTo(map);
}

function createMeetingPointMarker(data) {
    if (meetingPointMarker) meetingPointMarker.remove(); // Clear previous one

    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;

    const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <h3>نقطة تجمع: ${data.point.name}</h3>
        <p>أنشأها: ${data.creatorName}</p>
    `);

    meetingPointMarker = new mapboxgl.Marker(el)
        .setLngLat(data.point.location.coordinates)
        .setPopup(popup)
        .addTo(map);
}

function showGeneralMap() {
    // Clear friend-specific elements
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);
    if (meetingPointMarker) meetingPointMarker.remove();
    clearHistoricalPath();

    // Show general elements
    socket.emit('requestPOIs'); // Request fresh POIs for the general map

    // Fly to a general view of Iraq
    map.flyTo({
        center: [44.0249, 32.6163],
        zoom: 8,
        pitch: 45,
        bearing: -17.6
    });
}

function showFriendsMap() {
    // Clear general elements
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    clearHistoricalPath();

    // Redraw all friends and current user
    if (currentUser?.settings.shareLocation && !currentUser.settings.stealthMode) {
        createCustomMarker(currentUser);
    }
    linkedFriends.forEach(friend => {
        if (friend.settings?.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
    });

    // Zoom to fit all visible friends
    const visibleCoords = [];
    if (currentUser?.location?.coordinates && currentUser.settings.shareLocation && !currentUser.settings.stealthMode) {
        visibleCoords.push(currentUser.location.coordinates);
    }
    linkedFriends.forEach(friend => {
        if (friend.location?.coordinates && friend.settings?.shareLocation && !friend.settings.stealthMode) {
            visibleCoords.push(friend.location.coordinates);
        }
    });

    if (visibleCoords.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        visibleCoords.forEach(coord => bounds.extend(coord));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, pitch: 45, bearing: -17.6 });
    } else if (visibleCoords.length === 1) {
        map.flyTo({ center: visibleCoords[0], zoom: 14, pitch: 45, bearing: -17.6 });
    }
}

function clearHistoricalPath() {
    if (currentHistoricalPathLayer && map.getLayer(currentHistoricalPathLayer)) {
        map.removeLayer(currentHistoricalPathLayer);
        map.removeSource(currentHistoricalPathLayer);
        currentHistoricalPathLayer = null;
    }
}

function drawHistoricalPath(userId, pathCoordinates) {
    clearHistoricalPath();
    if (pathCoordinates.length < 2) return;

    currentHistoricalPathLayer = `historical-path-${userId}`;
    map.addSource(currentHistoricalPathLayer, {
        type: 'geojson',
        data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: pathCoordinates }
        }
    });
    map.addLayer({
        id: currentHistoricalPathLayer,
        type: 'line',
        source: currentHistoricalPathLayer,
        paint: { 'line-color': '#ff00ff', 'line-width': 5, 'line-opacity': 0.8 }
    });
    const bounds = new mapboxgl.LngLatBounds();
    pathCoordinates.forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, { padding: 50 });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ====== GPS Tracking ======
function startLocationTracking() {
    if (!navigator.geolocation) {
        alert("متصفحك لا يدعم تحديد المواقع.");
        return;
    }
    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            socket.emit('updateLocation', {
                location: [longitude, latitude],
                battery: await getBatteryStatus()
            });
        },
        (error) => console.error("خطأ في تحديد الموقع:", error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function getBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            return `${(battery.level * 100).toFixed(0)}%`;
        } catch (e) {
            return 'N/A';
        }
    }
    return 'N/A';
}

// ====== Chat and UI Functions ======
function playNotificationSound() {
    if (currentUser?.settings.sound) {
        new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(e => {});
    }
}

function showMessageBubble(userId, messageText) {
    const bubble = document.getElementById(`msg-bubble-${userId}`);
    if (bubble) {
        if (activeMessageTimers[userId]) clearTimeout(activeMessageTimers[userId]);
        bubble.textContent = messageText;
        bubble.classList.add('show');
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 30000);
    }
}

function addChatMessage(senderName, messageText, type, timestamp) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    const timeString = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<span class="message-meta">${senderName} - ${timeString}</span><br>${messageText}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateFriendBatteryStatus() {
    const list = document.getElementById('friendBatteryStatus');
    list.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const li = document.createElement('li');
            li.textContent = `${friend.name}: ${friend.batteryStatus || 'N/A'}`;
            list.appendChild(li);
        });
    } else {
        list.innerHTML = '<li>لا يوجد أصدقاء لعرض حالة بطاريتهم.</li>';
    }
}

function setupChatPanel() {
    const chatFriendSelect = document.getElementById('chatFriendSelect');
    chatFriendSelect.innerHTML = ''; // Clear previous options
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            chatFriendSelect.appendChild(option);
        });
        currentChatFriendId = chatFriendSelect.value || linkedFriends[0].userId;
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        document.getElementById('chatMessages').innerHTML = '<p>لا يوجد أصدقاء للدردشة.</p>';
    }
}

function setupBottomChatBar() {
    const bar = document.getElementById('bottomChatBar');
    const select = document.getElementById('bottomChatFriendSelect');
    select.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            select.appendChild(option);
        });
        currentChatFriendId = select.value;
        bar.classList.add('active');
    } else {
        bar.classList.remove('active');
        currentChatFriendId = null;
    }
}

// ====== Socket.IO Event Handlers ======

socket.on('connect', () => {
    console.log('✅ متصل بالخادم!');
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Date.now() + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('appUserId', userId);
    }
    socket.emit('registerUser', {
        userId,
        name: localStorage.getItem('appUserName'),
        photo: localStorage.getItem('appUserPhoto'),
        gender: localStorage.getItem('appUserGender'),
        phone: localStorage.getItem('appUserPhone'),
        email: localStorage.getItem('appUserEmail'),
        emergencyWhatsapp: localStorage.getItem('appEmergencyWhatsapp')
    });
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    console.log('👤 بيانات المستخدم الحالي:', currentUser);

    // Store all data locally
    Object.keys(user).forEach(key => {
        if (typeof user[key] === 'object' && user[key] !== null) {
            localStorage.setItem(`appUser${key.charAt(0).toUpperCase() + key.slice(1)}`, JSON.stringify(user[key]));
        } else if (key === 'settings') {
             localStorage.setItem('appEmergencyWhatsapp', user.settings.emergencyWhatsapp || '');
        } else {
            localStorage.setItem(`appUser${key.charAt(0).toUpperCase() + key.slice(1)}`, user[key] || '');
        }
    });
    localStorage.setItem('appUserName', user.name);


    // Update UI elements
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userPhoto').src = user.photo;
    document.getElementById('userLinkCode').textContent = user.linkCode;
    document.getElementById('editUserNameInput').value = user.name;
    document.getElementById('editGenderSelect').value = user.gender || 'other';
    document.getElementById('editPhoneInput').value = user.phone || '';
    document.getElementById('editEmailInput').value = user.email || '';
    document.getElementById('emergencyWhatsappInput').value = user.settings.emergencyWhatsapp || '';
    document.getElementById('shareLocationToggle').checked = user.settings.shareLocation;
    document.getElementById('soundToggle').checked = user.settings.sound;
    document.getElementById('hideBubblesToggle').checked = user.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = user.settings.stealthMode;

    if (!user.name || !user.gender || user.gender === 'other' || !user.phone || !user.email) {
        togglePanel('initialInfoPanel');
    }

    startLocationTracking();

    if (user.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: user.linkedFriends });
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate = (currentUser?.userId === data.userId) ? currentUser : linkedFriends.find(f => f.userId === data.userId);
    if (userToUpdate) {
        Object.assign(userToUpdate, data); // Update user object with new data
        if (userToUpdate.settings.shareLocation && !userToUpdate.settings.stealthMode) {
            createCustomMarker(userToUpdate);
        } else {
            if (friendMarkers[userToUpdate.userId]) {
                friendMarkers[userToUpdate.userId].remove();
                delete friendMarkers[userToUpdate.userId];
            }
        }
    }
});

socket.on('removeUserMarker', (data) => {
    if (friendMarkers[data.userId]) {
        friendMarkers[data.userId].remove();
        delete friendMarkers[data.userId];
    }
});

socket.on('linkStatus', (data) => alert(data.message));
socket.on('unfriendStatus', (data) => alert(data.message));
socket.on('poiStatus', (data) => alert(data.message));
socket.on('moazebStatus', (data) => alert(data.message));


socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    console.log('🔄 تم تحديث قائمة الأصدقاء:', linkedFriends);

    const friendsListEl = document.getElementById('friendsList');
    friendsListEl.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${friend.photo}" style="width:30px; height:30px; border-radius:50%;">
                <span>${friend.name}</span>
                <button class="unfriend-in-list-btn" data-friend-id="${friend.userId}" title="إلغاء الربط"><i class="fas fa-user-minus"></i></button>
            `;
            friendsListEl.appendChild(li);
        });
        document.querySelectorAll('.unfriend-in-list-btn').forEach(btn => {
            btn.onclick = (e) => {
                const friendId = e.currentTarget.dataset.friendId;
                const friendName = linkedFriends.find(f => f.userId === friendId)?.name;
                unfriendFromPopup(friendId, friendName);
            };
        });
    } else {
        friendsListEl.innerHTML = '<li>لا يوجد أصدقاء مرتبطون.</li>';
    }

    showFriendsMap();
    setupBottomChatBar();
    updateFriendBatteryStatus();
});

socket.on('newChatMessage', (data) => {
    if (currentUser?.userId === data.receiverId) {
        playNotificationSound();
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(data.senderId, data.message);
        }
        if (currentChatFriendId === data.senderId && document.getElementById('chatPanel').classList.contains('active')) {
            addChatMessage(data.senderName, data.message, 'received', data.timestamp);
        }
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatMessagesDiv.innerHTML = '';
    if (data.success && data.history.length > 0) {
        data.history.forEach(msg => {
            const type = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            const name = (type === 'sent') ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(name, msg.message, type, msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p>لا توجد رسائل سابقة.</p>';
    }
});

socket.on('historicalPathData', (data) => {
    if (data.success) {
        if (data.path.length > 0) {
            const coordinates = data.path.map(loc => loc.location.coordinates);
            drawHistoricalPath(data.userId, coordinates);
            togglePanel(null);
            showFriendsMap();
        } else {
            alert(`لا توجد بيانات مسار تاريخي لـ ${data.userId}.`);
        }
    } else {
        alert(`فشل جلب المسار: ${data.message}`);
    }
});

// Listen for the broadcast to update POIs, then request them
socket.on('updatePOIs', () => {
    if (document.getElementById('showGeneralMapBtn').classList.contains('active')) {
         socket.emit('requestPOIs');
    }
});

socket.on('updatePOIsList', (poisData) => {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    poisData.forEach(poi => createPOIMarker(poi));
});

socket.on('newMeetingPoint', (data) => {
    createMeetingPointMarker(data);
    alert(`قام ${data.creatorName} بإنشاء نقطة تجمع جديدة.`);
    if (data.creatorId === currentUser?.userId) {
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('endMeetingPointBtn').style.display = 'block';
    }
});

socket.on('meetingPointCleared', (data) => {
    if (meetingPointMarker) {
        meetingPointMarker.remove();
        meetingPointMarker = null;
    }
    alert(`تم إنهاء نقطة التجمع.`);
    if (data.creatorId === currentUser?.userId) {
        document.getElementById('setMeetingPointBtn').style.display = 'block';
        document.getElementById('endMeetingPointBtn').style.display = 'none';
    }
});

socket.on('prayerTimesData', (data) => {
    const display = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        const timings = data.timings;
        display.innerHTML = `
            <p><strong>الفجر:</strong> ${timings.Fajr}</p>
            <p><strong>الظهر:</strong> ${timings.Dhuhr}</p>
            <p><strong>العصر:</strong> ${timings.Asr}</p>
            <p><strong>المغرب:</strong> ${timings.Maghrib}</p>
            <p><strong>العشاء:</strong> ${timings.Isha}</p>
        `;
    } else {
        display.innerHTML = `<p style="color:var(--danger-color);">${data.message}</p>`;
    }
});

socket.on('moazebSearchResults', (data) => {
    const container = document.getElementById('moazebResultsContainer');
    container.innerHTML = '';
    if (data.success && data.results.length > 0) {
        data.results.forEach(moazeb => {
            const card = document.createElement('div');
            card.className = 'moazeb-card';
            card.innerHTML = `
                <h4>${moazeb.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
                <p><i class="fas fa-city"></i> ${moazeb.governorate} - ${moazeb.district}</p>
                <p><i class="fas fa-phone"></i> <a href="tel:${moazeb.phone}">${moazeb.phone}</a></p>
            `;
            container.appendChild(card);
        });
    } else {
        container.innerHTML = '<p>لم يتم العثور على نتائج.</p>';
    }
});


// ====== DOMContentLoaded - Main Execution Block ======
document.addEventListener('DOMContentLoaded', () => {

    // --- Panel Toggling Buttons ---
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => { togglePanel(null); showGeneralMap(); });
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => { togglePanel(null); showFriendsMap(); });
    document.getElementById('showProfileBtn').addEventListener('click', () => togglePanel('profilePanel'));
    document.getElementById('showConnectBtn').addEventListener('click', () => togglePanel('connectPanel'));
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));
    document.getElementById('showFeaturesBtn').addEventListener('click', () => {
        // Populate historical path dropdown before showing
        const select = document.getElementById('historicalPathUserSelect');
        select.innerHTML = `<option value="${currentUser.userId}">${currentUser.name} (أنا)</option>`;
        linkedFriends.forEach(friend => {
            select.innerHTML += `<option value="${friend.userId}">${friend.name}</option>`;
        });
        updateFriendBatteryStatus();
        socket.emit('requestPrayerTimes');
        togglePanel('featuresPanel');
    });
    document.getElementById('showSettingsBtn').addEventListener('click', () => togglePanel('settingsPanel'));

    // --- Initial Info Panel ---
    document.getElementById('initialInfoConfirmBtn').addEventListener('click', () => {
        const settings = {
            name: document.getElementById('initialInfoNameInput').value.trim(),
            gender: document.getElementById('initialInfoGenderSelect').value,
            phone: document.getElementById('initialInfoPhoneInput').value.trim(),
            email: document.getElementById('initialInfoEmailInput').value.trim(),
        };
        if (Object.values(settings).some(v => !v) || settings.gender === 'other') {
            alert('الرجاء ملء جميع الحقول بشكل صحيح.');
            return;
        }
        socket.emit('updateSettings', settings);
        // Also update local storage immediately
        localStorage.setItem('appUserName', settings.name);
        localStorage.setItem('appUserGender', settings.gender);
        localStorage.setItem('appUserPhone', settings.phone);
        localStorage.setItem('appUserEmail', settings.email);
        alert('تم حفظ معلوماتك.');
        togglePanel(null);
    });

    // --- Profile Panel ---
    document.getElementById('copyLinkCodeBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('userLinkCode').textContent)
            .then(() => alert('تم نسخ رمز الربط!'))
            .catch(() => alert('فشل النسخ.'));
    });
    document.getElementById('generateCodeBtn').addEventListener('click', () => alert('هذه الميزة غير متاحة حالياً.'));
    document.getElementById('updateProfileInfoBtn').addEventListener('click', () => {
        const settings = {
            name: document.getElementById('editUserNameInput').value.trim(),
            gender: document.getElementById('editGenderSelect').value,
            phone: document.getElementById('editPhoneInput').value.trim(),
            email: document.getElementById('editEmailInput').value.trim(),
        };
        socket.emit('updateSettings', settings);
        alert('تم تحديث الملف الشخصي.');
    });

    // --- Connect Panel ---
    document.getElementById('connectFriendBtn').addEventListener('click', () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if (friendCode) {
            socket.emit('requestLink', { friendCode });
            document.getElementById('friendCodeInput').value = '';
        } else {
            alert('الرجاء إدخال رمز الربط.');
        }
    });

    // --- Chat ---
    document.getElementById('bottomChatSendBtn').addEventListener('click', () => {
        const message = document.getElementById('bottomChatInput').value.trim();
        if (message && currentChatFriendId) {
            socket.emit('chatMessage', { receiverId: currentChatFriendId, message });
            showMessageBubble(currentUser.userId, message);
            document.getElementById('bottomChatInput').value = '';
        }
    });
    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => {
        if (linkedFriends.length === 0) {
            alert("يجب ربط صديق أولاً لعرض سجل الدردشة.");
            return;
        }
        setupChatPanel();
        togglePanel('chatPanel');
    });
    document.getElementById('chatFriendSelect').addEventListener('change', (e) => {
        currentChatFriendId = e.target.value;
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    });

    // --- Features Panel ---
    document.getElementById('viewHistoricalPathBtn').addEventListener('click', () => {
        const targetUserId = document.getElementById('historicalPathUserSelect').value;
        socket.emit('requestHistoricalPath', { targetUserId, limit: 200 });
    });
    document.getElementById('clearHistoricalPathBtn').addEventListener('click', () => {
        clearHistoricalPath();
        alert('تم مسح المسار من الخريطة.');
    });
    document.getElementById('setMeetingPointBtn').addEventListener('click', () => {
        const name = document.getElementById('meetingPointInput').value.trim();
        if (!name) {
            alert('الرجاء إدخال اسم لنقطة التجمع.');
            return;
        }
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0)) {
            alert("موقعك الحالي غير متاح. يرجى الانتظار أو تفعيل GPS.");
            return;
        }
        socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates });
    });
    document.getElementById('endMeetingPointBtn').addEventListener('click', () => {
        socket.emit('clearMeetingPoint');
    });
    // Populate POI categories
    const poiCategorySelect = document.getElementById('poiCategorySelect');
    const categories = {'Rest Area':'استراحة', 'Medical Post':'نقطة طبية', 'Food Station':'محطة طعام', 'Water':'ماء', 'Mosque':'مسجد', 'Parking':'موقف سيارات', 'Info':'معلومات', 'Other':'أخرى'};
    Object.entries(categories).forEach(([value, text]) => {
        poiCategorySelect.innerHTML += `<option value="${value}">${text}</option>`;
    });
    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0)) {
            alert("موقعك الحالي غير متاح. يرجى الانتظار أو تفعيل GPS.");
            return;
        }
        const name = prompt("أدخل اسم نقطة الاهتمام:");
        if (name) {
            const description = prompt("أدخل وصفاً (اختياري):");
            const category = document.getElementById('poiCategorySelect').value;
            socket.emit('addCommunityPOI', {
                name, description, category,
                location: currentUser.location.coordinates
            });
        }
    });
    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', () => socket.emit('requestPrayerTimes'));
    document.getElementById('mapPitch').addEventListener('input', (e) => map.setPitch(e.target.value));
    document.getElementById('mapBearing').addEventListener('input', (e) => map.setBearing(e.target.value));

    // --- Moazeb Panel ---
    document.getElementById('searchMoazebBtn').addEventListener('click', () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim(),
        };
        socket.emit('searchMoazeb', query);
    });
    document.getElementById('addMoazebBtn').addEventListener('click', () => {
         if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0)) {
            alert("موقعك الحالي غير متاح لإضافة مضيف. يرجى الانتظار أو تفعيل GPS.");
            return;
        }
        const moazebData = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
            location: currentUser.location.coordinates
        };
        if (!moazebData.name || !moazebData.address || !moazebData.phone || !moazebData.governorate || !moazebData.district) {
            alert("الرجاء ملء جميع حقول المضيف.");
            return;
        }
        socket.emit('addMoazeb', moazebData);
    });


    // --- Settings Panel & Toggles ---
    const settingsToggles = {
        shareLocation: 'shareLocationToggle',
        sound: 'soundToggle',
        hideBubbles: 'hideBubblesToggle',
        stealthMode: 'stealthModeToggle'
    };
    Object.entries(settingsToggles).forEach(([key, id]) => {
        document.getElementById(id).addEventListener('change', (e) => {
            socket.emit('updateSettings', { [key]: e.target.checked });
        });
    });
    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => {
        const emergencyWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
        if (emergencyWhatsapp.match(/^\d{10,15}$/)) { // Basic validation for phone number
            socket.emit('updateSettings', { emergencyWhatsapp });
            localStorage.setItem('appEmergencyWhatsapp', emergencyWhatsapp);
            alert('تم حفظ رقم الطوارئ.');
        } else {
            alert('الرجاء إدخال رقم واتساب صحيح (بدون رموز).');
        }
    });
    
    // --- SOS Button ---
    document.getElementById('sosButton').addEventListener('click', () => {
        if (!currentUser) return;
        const emergencyWhatsapp = currentUser.settings.emergencyWhatsapp;
        if (!emergencyWhatsapp) {
            alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات أولاً.");
            togglePanel('settingsPanel');
            return;
        }
        if (confirm("هل أنت متأكد؟ سيتم إرسال موقعك إلى رقم الطوارئ المسجل.")) {
            let message = `🚨 *مساعدة عاجلة* 🚨\n\nأنا (${currentUser.name}) بحاجة للمساعدة.\n`;
            if (currentUser.location?.coordinates && currentUser.location.coordinates[0] !== 0) {
                const [lng, lat] = currentUser.location.coordinates;
                message += `موقعي الحالي:\nhttps://www.google.com/maps?q=${lat},${lng}`;
            } else {
                message += "موقعي غير متاح حالياً.";
            }
            window.open(`https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`, '_blank');
        }
    });
});
