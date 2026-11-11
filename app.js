
(function () {
    "use strict";

    var settings = {
        apiUrl: localStorage.getItem("el_api_url") || "",
        deviceCode: localStorage.getItem("el_device_code") || "STATION-001",
        token: localStorage.getItem("el_token") || ""
    };

    var alarmActive = false;
    var maintenanceMode = false;
    var audioContext = null;
    var alarmOscillator = null;
    var alarmGain = null;
    var pollTimer = null;

    var homeScreen = document.getElementById("homeScreen");
    var settingsScreen = document.getElementById("settingsScreen");

    var connection = document.getElementById("connection");
    var alarmStatus = document.getElementById("alarmStatus");
    var deviceStatus = document.getElementById("deviceStatus");

    function showMessage(message) {
        document.getElementById("settingsMessage").textContent = message;
    }

    function showSettings() {
        homeScreen.hidden = true;
        settingsScreen.hidden = false;

        document.getElementById("apiUrl").value = settings.apiUrl;
        document.getElementById("deviceCode").value = settings.deviceCode;
    }

    function showHome() {
        settingsScreen.hidden = true;
        homeScreen.hidden = false;
    }

    function saveSettings() {
        settings.apiUrl =
            document.getElementById("apiUrl").value.trim();

        settings.deviceCode =
            document.getElementById("deviceCode").value.trim();

        localStorage.setItem("el_api_url", settings.apiUrl);
        localStorage.setItem("el_device_code", settings.deviceCode);

        showMessage("Settings saved.");
        updateConnection();
    }

    function updateConnection() {
        if (settings.token && settings.apiUrl) {
            connection.textContent = "DEVICE CONFIGURED";
            connection.style.color = "#70df91";
        } else {
            connection.textContent = "NOT PAIRED";
            connection.style.color = "#ffb347";
        }
    }

    /*
     * Simple JSON API helper.
     * The dashboard API should accept POST requests with JSON bodies.
     */
    function apiRequest(action, data, callback) {
        if (!settings.apiUrl) {
            if (callback) callback(null, "No API URL configured");
            return;
        }

        var xhr = new XMLHttpRequest();

        xhr.open(
            "POST",
            settings.apiUrl + "?action=" + encodeURIComponent(action),
            true
        );

        xhr.setRequestHeader("Content-Type", "application/json");

        if (settings.token) {
            xhr.setRequestHeader("Authorization", "Bearer " + settings.token);
        }

        xhr.timeout = 10000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var result = JSON.parse(xhr.responseText);
                    if (callback) callback(result, null);
                } catch (error) {
                    if (callback) callback(null, "Invalid server response");
                }
            } else {
                if (callback) callback(null, "Server error: " + xhr.status);
            }
        };

        xhr.onerror = function () {
            if (callback) callback(null, "Network connection failed");
        };

        xhr.ontimeout = function () {
            if (callback) callback(null, "Server request timed out");
        };

        xhr.send(JSON.stringify(data || {}));
    }

    function logEvent(eventName, details) {
        if (!settings.token) return;

        apiRequest("event", {
            event: eventName,
            details: details || "",
            device_code: settings.deviceCode
        });
    }

    /*
     * Start a repeating alarm.
     * This uses Web Audio where supported by the phone.
     */
    function startAlarm() {
        if (alarmActive) return;

        alarmActive = true;
        alarmStatus.textContent = "ALARM ACTIVE";
        alarmStatus.style.color = "#ff5555";
        deviceStatus.textContent = "WARNING: ALARM ACTIVE";

        try {
            var AudioContextClass =
                window.AudioContext || window.webkitAudioContext;

            if (AudioContextClass) {
                audioContext = new AudioContextClass();

                alarmOscillator = audioContext.createOscillator();
                alarmGain = audioContext.createGain();

                alarmOscillator.type = "square";
                alarmOscillator.frequency.value = 900;

                alarmGain.gain.value = 0.45;

                alarmOscillator.connect(alarmGain);
                alarmGain.connect(audioContext.destination);

                alarmOscillator.start();

                var highTone = false;

                window.alarmToneTimer = setInterval(function () {
                    if (!alarmActive || !alarmOscillator) return;

                    highTone = !highTone;
                    alarmOscillator.frequency.value =
                        highTone ? 1200 : 700;
                }, 350);
            } else {
                alarmStatus.textContent =
                    "ALARM REQUESTED - AUDIO NOT SUPPORTED";
            }
        } catch (error) {
            alarmStatus.textContent =
                "ALARM ACTIVE - AUDIO ERROR";
        }

        logEvent("alarm_started", "Local alarm activated");
    }

    function stopAlarm() {
        if (!alarmActive) return;

        alarmActive = false;

        if (window.alarmToneTimer) {
            clearInterval(window.alarmToneTimer);
            window.alarmToneTimer = null;
        }

        try {
            if (alarmOscillator) {
                alarmOscillator.stop();
                alarmOscillator.disconnect();
            }

            if (alarmGain) {
                alarmGain.disconnect();
            }

            if (audioContext && audioContext.close) {
                audioContext.close();
            }
        } catch (error) {
            // The alarm may already have stopped.
        }

        audioContext = null;
        alarmOscillator = null;
        alarmGain = null;

        alarmStatus.textContent = "Alarm is off";
        alarmStatus.style.color = "#ffcc55";
        deviceStatus.textContent = maintenanceMode
            ? "Maintenance mode active"
            : "Emergency station ready";

        logEvent("alarm_stopped", "Alarm stopped");
    }

    /*
     * Emergency action.
     * The user must press this button. It does not call 911 on startup.
     */
    function callEmergency() {
        startAlarm();

        logEvent("emergency_button_pressed", "911 dialer requested");

        // Opens the phone's emergency calling interface.
        // KaiOS/carrier firmware may require confirmation.
        window.location.href = "tel:911";
    }

    function pairDevice() {
        saveSettings();

        var pairingCode =
            document.getElementById("pairCode").value.trim();

        if (!settings.apiUrl || !settings.deviceCode || !pairingCode) {
            showMessage("Enter the API URL, device code, and pairing code.");
            return;
        }

        apiRequest("pair", {
            device_code: settings.deviceCode,
            pairing_code: pairingCode
        }, function (result, error) {
            if (error || !result || !result.success || !result.token) {
                showMessage(error || "Pairing failed. Check your code.");
                return;
            }

            settings.token = result.token;
            localStorage.setItem("el_token", settings.token);

            document.getElementById("pairCode").value = "";

            showMessage("Device paired successfully.");
            updateConnection();
            startPolling();
        });
    }

    function sendHeartbeat() {
        if (!settings.token) return;

        apiRequest("heartbeat", {
            device_code: settings.deviceCode,
            online: true,
            alarm_active: alarmActive,
            maintenance_mode: maintenanceMode,
            app_version: "1.0.0",
            connection: navigator.onLine ? "online" : "offline"
        });
    }

    function processCommands(commands) {
        if (!commands || !commands.length) return;

        commands.forEach(function (command) {
            if (command.action === "stop_alarm") {
                stopAlarm();
            }

            if (command.action === "maintenance_on") {
                maintenanceMode = true;
                deviceStatus.textContent =
                    "Maintenance mode active - 911 remains available";
                logEvent("maintenance_enabled", "Remote command");
            }

            if (command.action === "maintenance_off") {
                maintenanceMode = false;
                deviceStatus.textContent = alarmActive
                    ? "WARNING: ALARM ACTIVE"
                    : "Emergency station ready";
                logEvent("maintenance_disabled", "Remote command");
            }
        });
    }

    function pollDashboard() {
        if (!settings.token || !navigator.onLine) {
            connection.textContent = "OFFLINE";
            connection.style.color = "#ffb347";
            return;
        }

        apiRequest("poll", {
            device_code: settings.deviceCode
        }, function (result, error) {
            if (error || !result) {
                connection.textContent = "SERVER UNAVAILABLE";
                connection.style.color = "#ffb347";
                return;
            }

            connection.textContent = "CONNECTED";
            connection.style.color = "#70df91";

            processCommands(result.commands || []);
        });

        sendHeartbeat();
    }

    function startPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
        }

        if (!settings.token) return;

        pollDashboard();

        // Poll every 15 seconds while the app is running.
        pollTimer = setInterval(function () {
            if (!document.hidden) {
                pollDashboard();
            }
        }, 15000);
    }

    document.getElementById("callButton").onclick = callEmergency;
    document.getElementById("testButton").onclick = startAlarm;
    document.getElementById("stopButton").onclick = stopAlarm;

    document.getElementById("settingsButton").onclick = showSettings;
    document.getElementById("backButton").onclick = showHome;

    document.getElementById("saveButton").onclick = saveSettings;
    document.getElementById("pairButton").onclick = pairDevice;

    document.getElementById("maintenanceButton").onclick = function () {
        maintenanceMode = !maintenanceMode;

        deviceStatus.textContent = maintenanceMode
            ? "Maintenance mode active - 911 remains available"
            : "Emergency station ready";

        logEvent(
            maintenanceMode ? "maintenance_enabled" : "maintenance_disabled",
            "Changed on phone"
        );
    };

    window.addEventListener("online", function () {
        pollDashboard();
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            pollDashboard();
        }
    });

    updateConnection();

    if (settings.token && settings.apiUrl) {
        startPolling();
    }
})();
