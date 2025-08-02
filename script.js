// script.js

mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null,
    true
);

// ====== إعدادات Mapbox ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [43.6875, 33.3152], // مركز العراق
    zoom: 6,
    pitch: 45,
    bearing: -17.6
});

// ====== متغيرات عامة ======
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {};
const poiMarkers = {};
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};
let meetingPointMarker = null; // لتخزين مركر نقطة التجمع

// اتصال Socket.IO
const socket = io('https://tareeqaljannah-app.onrender.com');

// ====== وظائف عامة للواجهة الرسومية (UI Helpers) ======

function togglePanel(panelId) {
    document.querySelectorAll('.overlay-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.querySelectorAll('.main-header nav button').forEach(btn => {
        btn.classList.remove('active');
    });
    if (panelId) {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.classList.add('active');
            const button = document.querySelector(`button[id$="${panelId.replace('Panel', 'Btn')}"]`);
            if (button) button.classList.add('active');
        }
    }
}

document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.getElementById('showGeneralMapBtn').classList.add('active');
    });
});

// ====== وظائف الخريطة والمواقع (Map & Location Functions) ======

function createCustomMarker(user) {
    if (!user || !user.location || !user.location.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
        return null;
    }
    if (friendMarkers[user.userId]) {
        friendMarkers[user.userId].remove();
    }
    const el = document.createElement('div');
    el.className = 'mapboxgl-marker';
    el.classList.add(user.userId === currentUser.userId ? 'current-user-marker' : 'friend-marker');
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
        // Pop-up logic can be added here if needed
    }

    friendMarkers[user.userId] = marker;
    return marker;
}

function createPOIMarker(poi) {
    if (!poi || !poi.location || !poi.location.coordinates) return null;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const marker = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <h3>${poi.name}</h3>
            <p>${poi.description || ''}</p>
            <p><strong>الفئة:</strong> ${poi.category}</p>
        `))
        .addTo(map);

    poiMarkers[poi._id] = marker;
    return marker;
}


// تغيير مدة ظهور الفقاعة إلى 15 ثانية
function showMessageBubble(userId, messageText) {
    const bubble = document.getElementById(`msg-bubble-${userId}`);
    if (bubble) {
        if (activeMessageTimers[userId]) {
            clearTimeout(activeMessageTimers[userId]);
        }
        bubble.textContent = messageText;
        bubble.classList.add('show');
        activeMessageTimers[userId] = setTimeout(() => {
            bubble.classList.remove('show');
        }, 15000); // 15 ثانية
    }
}

// دالة لرسم نقطة التجمع
function drawMeetingPoint(data) {
    clearMeetingPointMarker();
    if (!data || !data.point || !data.point.location || !data.point.location.coordinates || data.point.location.coordinates.length < 2) {
        return;
    }
    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;
    meetingPointMarker = new mapboxgl.Marker(el)
        .setLngLat(data.point.location.coordinates)
        .setPopup(new mapboxgl.Popup().setHTML(`
            <h3>نقطة تجمع: ${data.point.name}</h3>
            <p>أنشأها: ${data.creatorName}</p>
        `))
        .addTo(map);
}

// دالة لمسح نقطة التجمع
function clearMeetingPointMarker() {
    if (meetingPointMarker) {
        meetingPointMarker.remove();
        meetingPointMarker = null;
    }
}

// جلب أوقات الصلاة من الخادم
function fetchAndDisplayPrayerTimes() {
    const displayElement = document.getElementById('prayerTimesDisplay');
    displayElement.innerHTML = '<p>جاري جلب أوقات الصلاة...</p>';
    socket.emit('requestPrayerTimes');
}

// دالة لعرض نتائج بحث المعزب
function displayMoazebResults(results) {
    const container = document.getElementById('moazebResultsContainer');
    container.innerHTML = '';
    if (!results || results.length === 0) {
        container.innerHTML = '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>';
        return;
    }
    results.forEach(moazeb => {
        const card = document.createElement('div');
        card.className = 'moazeb-card';
        card.innerHTML = `
            <h4>${moazeb.name}</h4>
            <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
            <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
            <p><i class="fas fa-globe-asia"></i> ${moazeb.governorate} - ${moazeb.district}</p>
        `;
        container.appendChild(card);
    });
}

// نظام تحديد المواقع (GPS)
function startLocationTracking() {
    if (!navigator.geolocation) return alert("متصفحك لا يدعم تحديد المواقع.");
    if (!currentUser) return;

    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            const battery = await getBatteryStatus();
            socket.emit('updateLocation', {
                userId: currentUser.userId,
                location: [longitude, latitude],
                battery: battery
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

// ====== التعامل مع أحداث WebSocket من الخادم ======
socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('appUserId', userId);
    }
    const userName = localStorage.getItem('appUserName') || null;
    const userPhoto = localStorage.getItem('appUserPhoto') || null;
    const gender = localStorage.getItem('appUserGender') || null;
    const phone = localStorage.getItem('appUserPhone') || null;
    const email = localStorage.getItem('appUserEmail') || null;
    const emergencyWhatsapp = localStorage.getItem('appEmergencyWhatsapp') || null;
    socket.emit('registerUser', { userId, name: userName, photo: userPhoto, gender, phone, email, emergencyWhatsapp });
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    console.log('تم استقبال بيانات المستخدم الحالي:', currentUser);

    // تحديث الواجهة ببيانات المستخدم
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userPhoto').src = currentUser.photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER';
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    
    // تحديث لوحة الملف الشخصي
    document.getElementById('editUserNameInput').value = currentUser.name;
    document.getElementById('editGenderSelect').value = currentUser.gender || 'other';
    document.getElementById('editPhoneInput').value = currentUser.phone || '';
    document.getElementById('editEmailInput').value = currentUser.email || '';
    
    // تحديث لوحة الإعدادات
    document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
    document.getElementById('soundToggle').checked = currentUser.settings.sound;
    document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;
    document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';

    // تحديث واجهة نقطة التجمع
    if (currentUser.meetingPoint && currentUser.meetingPoint.name) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('meetingPointInput').value = currentUser.meetingPoint.name;
        drawMeetingPoint({ creatorId: currentUser.userId, creatorName: currentUser.name, point: currentUser.meetingPoint });
    } else {
        document.getElementById('endMeetingPointBtn').style.display = 'none';
        document.getElementById('setMeetingPointBtn').style.display = 'block';
    }

    startLocationTracking();

    if (currentUser.linkedFriends && currentUser.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate;
    if (currentUser && data.userId === currentUser.userId) {
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
    }
    
    if (userToUpdate) {
        userToUpdate.location = { type: 'Point', coordinates: data.location };
        userToUpdate.settings = data.settings;
        
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

socket.on('updateFriendsList', (friends) => {
    linkedFriends = friends;
    Object.keys(friendMarkers).forEach(id => {
        if (!linkedFriends.find(f => f.userId === id) && id !== currentUser.userId) {
            friendMarkers[id].remove();
            delete friendMarkers[id];
        }
    });
    linkedFriends.forEach(friend => {
        if (friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
        if (friend.meetingPoint && friend.meetingPoint.name) {
             drawMeetingPoint({ creatorId: friend.userId, creatorName: friend.name, point: friend.meetingPoint });
        }
    });
});

socket.on('newChatMessage', (data) => {
    if (currentUser && data.receiverId === currentUser.userId) {
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(data.senderId, data.message);
        }
    }
});

socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        displayElement.innerHTML = `
            <p><strong>الفجر:</strong> ${data.timings.Fajr}</p>
            <p><strong>الشروق:</strong> ${data.timings.Sunrise}</p>
            <p><strong>الظهر:</strong> ${data.timings.Dhuhr}</p>
            <p><strong>العصر:</strong> ${data.timings.Asr}</p>
            <p><strong>المغرب:</strong> ${data.timings.Maghrib}</p>
            <p><strong>العشاء:</strong> ${data.timings.Isha}</p>
        `;
    } else {
        displayElement.innerHTML = `<p style="color: var(--danger-color);">${data.message}</p>`;
    }
});

socket.on('newMeetingPoint', (data) => {
    drawMeetingPoint(data);
    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        alert(`تم تحديد نقطة التجمع "${data.point.name}" بنجاح.`);
    }
});

socket.on('meetingPointCleared', (data) => {
    clearMeetingPointMarker();
    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'none';
        document.getElementById('setMeetingPointBtn').style.display = 'block';
        document.getElementById('meetingPointInput').value = '';
        alert('تم إنهاء نقطة التجمع.');
    }
});

socket.on('updatePOIsList', (pois) => {
    Object.keys(poiMarkers).forEach(id => poiMarkers[id].remove());
    pois.forEach(poi => createPOIMarker(poi));
});

socket.on('poiStatus', (data) => {
    alert(data.message);
});

socket.on('moazebStatus', (data) => {
    alert(data.message);
    if(data.success) {
        document.getElementById('addMoazebName').value = '';
        document.getElementById('addMoazebAddress').value = '';
        document.getElementById('addMoazebPhone').value = '';
        document.getElementById('addMoazebGov').value = '';
        document.getElementById('addMoazebDist').value = '';
    }
});

socket.on('moazebSearchResults', (data) => {
    if (data.success) {
        displayMoazebResults(data.results);
    } else {
        alert('حدث خطأ أثناء البحث.');
    }
});


// ====== ربط معالجات الأحداث عند تحميل الصفحة ======
document.addEventListener('DOMContentLoaded', () => {

    // أزرار التنقل الرئيسية
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => togglePanel(null));
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => togglePanel(null));
    document.getElementById('showProfileBtn').addEventListener('click', () => togglePanel('profilePanel'));
    document.getElementById('showConnectBtn').addEventListener('click', () => togglePanel('connectPanel'));
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));
    document.getElementById('showFeaturesBtn').addEventListener('click', () => {
        togglePanel('featuresPanel');
        fetchAndDisplayPrayerTimes();
    });
    document.getElementById('showSettingsBtn').addEventListener('click', () => togglePanel('settingsPanel'));

    // قسم المعزب
    document.getElementById('addMoazebBtn').addEventListener('click', () => {
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            return alert("يرجى تفعيل GPS وتحديد موقعك أولاً.");
        }
        const moazebData = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
            location: currentUser.location.coordinates
        };
        if (moazebData.name && moazebData.address && moazebData.phone && moazebData.governorate && moazebData.district) {
            socket.emit('addMoazeb', moazebData);
        } else {
            alert('الرجاء ملء جميع حقول المضيف.');
        }
    });

    document.getElementById('searchMoazebBtn').addEventListener('click', () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim()
        };
        if (query.phone || query.governorate || query.district) {
             socket.emit('searchMoazeb', query);
        } else {
            alert('الرجاء إدخال معيار واحد للبحث على الأقل.');
        }
    });

    // قسم الميزات
    const poiCategorySelect = document.getElementById('poiCategorySelect');
    const categories = [
        { value: 'Rest Area', text: 'استراحة', icon: '<i class="fas fa-bed"></i>' },
        { value: 'Medical Post', text: 'نقطة طبية', icon: '<i class="fas fa-medkit"></i>' },
        { value: 'Food Station', text: 'محطة طعام', icon: '<i class="fas fa-utensils"></i>' },
        { value: 'Water', text: 'ماء', icon: '<i class="fas fa-faucet"></i>' },
        { value: 'Mosque', text: 'مسجد', icon: '<i class="fas fa-mosque"></i>' },
        { value: 'Parking', text: 'موقف سيارات', icon: '<i class="fas fa-parking"></i>' },
        { value: 'Info', text: 'معلومات', icon: '<i class="fas fa-info-circle"></i>' },
        { value: 'Other', text: 'أخرى', icon: '<i class="fas fa-map-marker-alt"></i>' }
    ];
    poiCategorySelect.innerHTML = '';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.value;
        option.dataset.icon = cat.icon;
        option.innerHTML = cat.text;
        poiCategorySelect.appendChild(option);
    });

    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            return alert("يرجى تفعيل GPS وتحديد موقعك أولاً.");
        }
        const poiName = prompt("أدخل اسم نقطة الاهتمام:");
        if (poiName) {
            const selectedOption = poiCategorySelect.options[poiCategorySelect.selectedIndex];
            socket.emit('addCommunityPOI', {
                name: poiName,
                description: prompt("أدخل وصفاً (اختياري):"),
                category: selectedOption.value,
                location: currentUser.location.coordinates,
                icon: selectedOption.dataset.icon
            });
        }
    });
    
    document.getElementById('setMeetingPointBtn').addEventListener('click', () => {
        const meetingPointName = document.getElementById('meetingPointInput').value.trim();
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates) {
            return alert("لا يمكن تحديد نقطة تجمع بدون تحديد موقعك الحالي أولاً.");
        }
        if (meetingPointName) {
            socket.emit('setMeetingPoint', {
                name: meetingPointName,
                location: currentUser.location.coordinates
            });
        } else {
            alert("الرجاء إدخال اسم لنقطة التجمع.");
        }
    });

    document.getElementById('endMeetingPointBtn').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إنهاء نقطة التجمع الحالية؟')) {
            socket.emit('clearMeetingPoint');
        }
    });

    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', fetchAndDisplayPrayerTimes);
    
    // قسم الإعدادات
    ['shareLocationToggle', 'soundToggle', 'hideBubblesToggle', 'stealthModeToggle'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            if (!currentUser) return;
            const settingKey = id.replace('Toggle', '');
            currentUser.settings[settingKey] = e.target.checked;
            socket.emit('updateSettings', { [settingKey]: e.target.checked });
        });
    });

    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => {
        if (!currentUser) return;
        const newWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
        localStorage.setItem('appEmergencyWhatsapp', newWhatsapp);
        socket.emit('updateSettings', { emergencyWhatsapp: newWhatsapp });
        alert('تم حفظ رقم الواتساب للطوارئ.');
    });

    // زر الطوارئ
    document.getElementById('sosButton').addEventListener('click', () => {
        if (!currentUser) return;
        const emergencyWhatsapp = currentUser.settings.emergencyWhatsapp;
        if (!emergencyWhatsapp) {
            return alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات أولاً.");
        }
        if (confirm("هل أنت متأكد من إرسال إشارة استغاثة (SOS)؟")) {
            let message = `مساعدة عاجلة! أنا ${currentUser.name} بحاجة للمساعدة.\n`;
            if (currentUser.location && currentUser.location.coordinates) {
                const [lng, lat] = currentUser.location.coordinates;
                message += `موقعي: https://www.google.com/maps?q=${lat},${lng}`;
            } else {
                message += "موقعي غير متاح حالياً.";
            }
            const whatsappUrl = `https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');
        }
    });
});
