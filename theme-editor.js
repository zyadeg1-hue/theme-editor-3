/**
 * Theme Editor
 * @description A comprehensive theme customization tool for Spotify Desktop
 * @version 2.0.0
 * @author DizAAAr
 * @copyright 2026 DizAAAr. All rights reserved.
 */
(function ThemeEditorRefactored() {
  'use strict';

  // ==========================================================================================
  // ⚙️ MODULE: EXTENSION CONFIGURATION (Single Source of Truth)
  // ==========================================================================================
  const EXTENSION_CONFIG = {
    NAME: 'Theme Editor',
    VERSION: '2.1.0',
    AUTHOR: 'DizAAAr',
    DESCRIPTION: 'A comprehensive theme customization tool for Spotify Desktop',
    COPYRIGHT: '2026 DizAAAr. All rights reserved.',
    CONFIG_KEY: 'theme-editor-config',
    DEFAULT_FIREBASE_URL: 'https://theme-editor-97bf0-default-rtdb.europe-west1.firebasedatabase.app',
    ASSETS: {
      GIFS: {
        SONIC: 'https://media.tenor.com/pWqGD2PHY3kAAAAj/fortnite-dance-sonic.gif',
        JUMPING: 'https://media.tenor.com/vuMDJNZY76sAAAAi/jumping-blushing.gif',
        DUCK: 'https://image2url.com/r2/default/gifs/1768191336343-47d9abdb-1112-4847-9725-e17f9ff0a074.gif',
        ONEKO: 'https://raw.githubusercontent.com/adryd325/oneko.js/14bab15a755d0e35cd4ae19c931d96d306f99f42/oneko.gif'
      }
    }
  };

  const NAME = EXTENSION_CONFIG.NAME; // Kept for backward compat in this scope if needed, or replace usages
  const CONFIG_KEY = EXTENSION_CONFIG.CONFIG_KEY;

  // ==========================================================================================
  // ⏱️ MODULE: TIMING CONSTANTS (Eliminates Magic Numbers)
  // ==========================================================================================
  const TIMING = {
    INIT_DELAY: 300,
    INIT_RETRY: 100,
    SONG_CHANGE_DELAY: 500,
    QUEUE_UPDATE_DELAY: 300,
    DEBOUNCE_SLIDER: 150,
    AUTOPLAY_DELAY: 2000,
    COLOR_APPLY_DELAY: 2000,
    TOAST_DURATION: 3000,
    FEATURE_POLL_INTERVAL: 5000,
    SYNC_INTERVAL: 1000 // Sync playback every 1 second
  };

  // ==========================================================================================
  // 🔗 MODULE: SYNC SESSION (Firebase-based real-time music sync)
  // ==========================================================================================

  // Firebase Configuration - User needs to set their own database URL
  // Hardcoded default for easier sharing
  const DEFAULT_FIREBASE_URL = EXTENSION_CONFIG.DEFAULT_FIREBASE_URL;

  const FIREBASE_CONFIG = {
    databaseURL: localStorage.getItem('te-firebase-url') || DEFAULT_FIREBASE_URL
  };

  // Debug logs storage
  const debugLogs = [];
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    debugLogs.push(logEntry);
    console.log('[SyncSession]', message);
    // Keep only last 50 logs
    if (debugLogs.length > 50) debugLogs.shift();
  };

  const showLogsModal = () => {
    const existingModal = document.getElementById('te-logs-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'te-logs-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#1a1a2e;border:2px solid #0f3460;border-radius:12px;padding:20px;width:600px;max-width:90vw;max-height:80vh;overflow:auto;">
        <h3 style="color:#1db954;margin:0 0 15px;">📋 Sync Session Logs</h3>
        <div style="background:#0f3460;padding:12px;border-radius:8px;font-family:monospace;font-size:11px;color:#e0e0e0;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${debugLogs.length > 0 ? debugLogs.join('\n') : 'No logs yet. Try clicking Save or Create Session.'}</div>
        <div style="margin-top:15px;display:flex;gap:8px;">
          <button id="te-logs-copy" style="flex:1;padding:10px;background:#0f3460;color:#e0e0e0;border:1px solid #1a1a2e;border-radius:8px;cursor:pointer;">📋 Copy Logs</button>
          <button id="te-logs-close" style="flex:1;padding:10px;background:#e94560;color:#fff;border:none;border-radius:8px;cursor:pointer;">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#te-logs-close').onclick = () => modal.remove();
    modal.querySelector('#te-logs-copy').onclick = () => {
      navigator.clipboard.writeText(debugLogs.join('\n'));
      Toast.show('Logs copied! Paste them to share.', 'success');
    };
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  };

  const SyncSession = {
    sessionId: null,
    isHost: false,
    userId: null,
    userName: null,
    members: [],
    syncInterval: null,
    pollInterval: null,
    isActive: false,
    baseUrl: '',

    // REST API Helper: Write
    async firebaseWrite(path, data) {
      const url = `${this.baseUrl}/${path}.json`;
      addLog('PUT: ' + path);
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error('Write failed: ' + res.status);
      return await res.json();
    },

    // REST API Helper: Read
    async firebaseRead(path) {
      const res = await fetch(`${this.baseUrl}/${path}.json`);
      if (!res.ok) throw new Error('Read failed: ' + res.status);
      return await res.json();
    },

    // REST API Helper: Delete
    async firebaseDelete(path) {
      await fetch(`${this.baseUrl}/${path}.json`, { method: 'DELETE' });
    },

    /**
     * Initialize session (no SDK needed with REST API)
     */
    init() {
      this.baseUrl = localStorage.getItem('te-firebase-url') || DEFAULT_FIREBASE_URL;

      // Persistent User ID
      let storedId = localStorage.getItem('te-user-id');
      if (!storedId) {
        storedId = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('te-user-id', storedId);
      }
      this.userId = storedId;

      // Saved Name
      this.userName = localStorage.getItem('te-user-name') || this.getSpotifyUsername();

      // Member tracking for diffing
      this.previousMembers = [];

      // Sound context
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      addLog('Init: ' + this.userName + ' (' + this.userId + ')');
      addLog('baseUrl: ' + this.baseUrl);

      this.pollInvites();
    },

    promptForName(callback) {
      const maxLength = Config.data.maxNameLength || 15;
      const overlay = document.createElement('div');
      overlay.id = 'te-name-prompt';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:1000000;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
              <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border:2px solid #1db954;border-radius:12px;padding:24px;width:320px;text-align:center;">
                  <h3 style="color:#fff;margin:0 0 16px;">Who are you? 🤔</h3>
                  <input type="text" id="te-name-input" value="${this.userName !== 'Anonymous' ? this.userName : ''}" placeholder="Name (Max ${maxLength} chars)" maxlength="${maxLength}" style="width:100%;padding:10px;margin-bottom:8px;background:#0f3460;border:1px solid #333;color:#fff;border-radius:4px;box-sizing:border-box;">
                  <div id="te-name-error" style="color:#ff6b6b;font-size:12px;margin-bottom:12px;display:none;"></div>
                  <button id="te-name-confirm" style="width:100%;padding:10px;background:#1db954;color:#000;font-weight:bold;border:none;border-radius:500px;cursor:pointer;">Continue</button>
              </div>
          `;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#te-name-input');
      const errorMsg = overlay.querySelector('#te-name-error');
      input.focus();

      const badWords = ['admin', 'mod', 'root', 'fuck', 'shit', 'bitch', 'ass', 'dick', 'pussy', 'whore', 'slut', 'nigger', 'faggot', 'retard', 'autist', 'kys', 'kill'];

      const confirm = () => {
        const name = input.value.trim();

        if (!name) {
          errorMsg.innerText = 'Please enter a name.';
          errorMsg.style.display = 'block';
          return;
        }
        if (name.length > maxLength) {
          errorMsg.innerText = `Name must be ${maxLength} characters or less.`;
          errorMsg.style.display = 'block';
          return;
        }
        if (badWords.some(w => name.toLowerCase().includes(w))) {
          errorMsg.innerText = 'Please choose a different name.';
          errorMsg.style.display = 'block';
          return;
        }

        this.userName = name;
        localStorage.setItem('te-user-name', name);
        overlay.remove();
        callback();
      };

      overlay.querySelector('#te-name-confirm').onclick = confirm;
      input.onkeydown = (e) => {
        errorMsg.style.display = 'none';
        if (e.key === 'Enter') confirm();
      };
    },

    playNotificationSound(type = 'join') {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();
      osc.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      if (type === 'join') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1000, this.audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.1);
      } else {
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, this.audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.1);
      }
    },

    getSpotifyUsername() {
      try {
        return Spicetify.Platform?.UserAPI?._user?.displayName ||
          Spicetify.Platform?.UserAPI?._user?.username || 'Anonymous';
      } catch { return 'Anonymous'; }
    },

    generateSessionCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      return code;
    },

    getCurrentPlaybackState() {
      try {
        const p = Spicetify.Player;
        const q = Spicetify.Queue;
        let next = null;
        if (q && q.nextTracks) {
          const currentUri = p.data?.item?.uri;
          for (let i = 0; i < q.nextTracks.length; i++) {
            const t = q.nextTracks[i]?.contextTrack;
            if (t && t.uri !== currentUri) { next = t.metadata; break; }
          }
        }
        return {
          uri: p.data?.item?.uri || '',
          name: p.data?.item?.name || '',
          pos: p.getProgress() || 0,
          playing: p.isPlaying() || false,
          ts: Date.now(),
          nextTrack: next ? {
            title: next.title,
            artist_name: next.artist_name,
            image_url: next.image_url || next.image_small_url
          } : null
        };
      } catch { return { uri: '', name: '', pos: 0, playing: false, ts: Date.now() }; }
    },

    async createSession() {
      addLog('createSession() called');

      if (!this.baseUrl) {
        this.baseUrl = localStorage.getItem('te-firebase-url') || DEFAULT_FIREBASE_URL;
        if (!this.baseUrl) {
          Toast.show('Set Firebase URL first!', 'error');
          addLog('ERROR: No baseUrl');
          return null;
        }
      }

      this.init();

      const proceed = async () => {
        this.sessionId = this.generateSessionCode();
        addLog('Code: ' + this.sessionId);

        try {
          await this.firebaseWrite('sessions/' + this.sessionId, {
            host: this.userId,
            hostName: this.userName,
            created: Date.now(),
            members: { [this.userId]: { name: this.userName, isHost: true, joined: Date.now() } },
            playback: this.getCurrentPlaybackState()
          });

          this.isHost = true;
          this.isActive = true;
          this.members = [{ id: this.userId, name: this.userName, isHost: true }];

          this.startHostSync();

          Toast.show('Session: ' + this.sessionId, 'success');
          addLog('Created!');
          this.updateSessionUI();
          this.showSyncModal(); // Refresh modal to show lobby
          return this.sessionId;
        } catch (e) {
          addLog('ERROR: ' + e.message);
          this.isActive = false;
          this.isHost = false;
          Toast.show('Failed: ' + e.message, 'error');
          this.updateSessionUI();
          return null;
        }
      };

      this.promptForName(proceed);
      return; // Async flow continues in callback
    },

    async joinSession(code) {
      addLog('joinSession: ' + code);
      if (!this.baseUrl) {
        this.baseUrl = localStorage.getItem('te-firebase-url') || DEFAULT_FIREBASE_URL;
        if (!this.baseUrl) { Toast.show('Set Firebase URL first!', 'error'); return false; }
      }

      this.init();
      code = code.toUpperCase().trim();

      const proceed = async () => {
        try {
          const session = await this.firebaseRead('sessions/' + code);
          if (!session) { Toast.show('Session not found!', 'error'); return false; }
          if (Object.keys(session.members || {}).length >= 5) { Toast.show('Session full!', 'error'); return false; }

          await this.firebaseWrite('sessions/' + code + '/members/' + this.userId, { name: this.userName, isHost: false, joined: Date.now() });

          this.sessionId = code;
          this.isHost = false;
          this.isActive = true;
          this.startGuestSync();

          Toast.show('Joined: ' + code, 'success');
          addLog('Joined!');
          this.updateSessionUI();
          this.showSyncModal(); // Refresh
          return true;
        } catch (e) {
          addLog('ERROR: ' + e.message);
          Toast.show('Failed: ' + e.message, 'error');
          return false;
        }
      };

      this.promptForName(proceed);
      return;
    },

    async transferHost(newHostId, newHostName) {
      if (!this.isHost) return;
      try {
        await this.firebaseWrite('sessions/' + this.sessionId + '/host', newHostId);
        await this.firebaseWrite('sessions/' + this.sessionId + '/hostName', newHostName);
        // Note: We don't need to manually redundant isHost flags in members anymore, 
        // as we will trust the root 'host' property. But for backward compat we can update them.
        await this.firebaseWrite('sessions/' + this.sessionId + '/members/' + this.userId + '/isHost', false);
        await this.firebaseWrite('sessions/' + this.sessionId + '/members/' + newHostId + '/isHost', true);
        Toast.show(`Ownership transferred to ${newHostName}`, 'success');
        this.isHost = false; // Immediate local update
        document.body.classList.remove('te-guest-mode'); // Should be removed if we were guest, but here we were host.
        // Actually if we transfer, we BECOME guest.
        this.startGuestSync(); // Switch to guest mode
      } catch (e) { Toast.show('Transfer failed: ' + e.message, 'error'); }
    },

    async kickUser(memberId) {
      if (!this.isHost) return;
      try {
        await this.firebaseDelete('sessions/' + this.sessionId + '/members/' + memberId);
        Toast.show('User kicked 👢', 'info');
      } catch (e) { Toast.show('Kick failed: ' + e.message, 'error'); }
    },

    async inviteUser(targetId) {
      try {
        await this.firebaseWrite('invites/' + targetId + '/' + this.sessionId, {
          hostName: this.userName,
          sessionId: this.sessionId,
          ts: Date.now()
        });
        Toast.show('Invite sent! 📨', 'success');
      } catch (e) { Toast.show('Failed to send invite', 'error'); }
    },

    pollInvites() {
      setInterval(async () => {
        if (this.isActive) return; // Don't poll invites if already in a session
        try {
          const invites = await this.firebaseRead('invites/' + this.userId);
          if (invites) {
            Object.entries(invites).forEach(([key, inv]) => {
              if (Date.now() - inv.ts < 60000) { // Valid for 1 minute
                // Show join prompt
                if (!document.getElementById('te-invite-' + key)) {
                  this.showInviteModal(key, inv);
                }
              } else {
                // Clean up old invites
                this.firebaseDelete('invites/' + this.userId + '/' + key);
              }
            });
          }
        } catch (e) { }
      }, 5000);
    },

    showInviteModal(key, inv) {
      const div = document.createElement('div');
      div.id = 'te-invite-' + key;
      div.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1a1a2e;border:1px solid #1db954;padding:16px;border-radius:8px;z-index:9999999;box-shadow:0 10px 30px rgba(0,0,0,0.5);width:250px;animation:slideIn 0.3s ease;';
      div.innerHTML = `
            <div style="color:#fff;font-weight:bold;margin-bottom:8px;">📨 Invite from ${sanitizeText(inv.hostName)}</div>
            <div style="font-size:12px;color:#ccc;margin-bottom:12px;">Wants you to join their session.</div>
            <div style="display:flex;gap:8px;">
                <button id="inv-join" style="flex:1;background:#1db954;color:#000;border:none;padding:6px;border-radius:4px;cursor:pointer;font-weight:bold;">Join</button>
                <button id="inv-ignore" style="flex:1;background:transparent;border:1px solid #666;color:#ccc;padding:6px;border-radius:4px;cursor:pointer;">Ignore</button>
            </div>
        `;
      document.body.appendChild(div);

      div.querySelector('#inv-join').onclick = () => {
        this.joinSession(inv.sessionId);
        this.firebaseDelete('invites/' + this.userId + '/' + key);
        div.remove();
      };
      div.querySelector('#inv-ignore').onclick = () => {
        this.firebaseDelete('invites/' + this.userId + '/' + key);
        div.remove();
      };
    },

    addToRecentUsers(members) {
      let recent = JSON.parse(localStorage.getItem('te-recent-users') || '[]');
      let changed = false;
      members.forEach(m => {
        if (m.id !== this.userId && !recent.find(r => r.id === m.id)) {
          recent.unshift({ id: m.id, name: m.name, lastSeen: Date.now() });
          changed = true;
        }
      });
      if (changed) {
        recent = recent.slice(0, 10);
        localStorage.setItem('te-recent-users', JSON.stringify(recent));
      }
    },

    startHostSync() {
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (this.pollInterval) clearInterval(this.pollInterval);
      document.body.classList.remove('te-guest-mode');

      this.syncInterval = setInterval(async () => {
        if (!this.isActive || !this.isHost) return;
        try { await this.firebaseWrite('sessions/' + this.sessionId + '/playback', this.getCurrentPlaybackState()); } catch (e) { }
      }, 2000);

      this.pollInterval = setInterval(async () => {
        if (!this.isActive) return;
        try {
          const session = await this.firebaseRead('sessions/' + this.sessionId);
          if (session) {
            // Verify if I am still the host according to server
            if (session.host !== this.userId) {
              this.isHost = false;
              this.startGuestSync();
              Toast.show('You are no longer the Host', 'info');
              return;
            }
            if (session.members) {
              // Reconstruct members list
              const currentMembers = Object.entries(session.members).map(([id, v]) => ({
                id,
                ...v,
                isHost: id === session.host
              }));

              // Diffing for Notifications
              if (this.previousMembers.length > 0) {
                const joined = currentMembers.filter(c => !this.previousMembers.find(p => p.id === c.id));
                const left = this.previousMembers.filter(p => !currentMembers.find(c => c.id === p.id));

                joined.forEach(m => {
                  if (m.id !== this.userId) {
                    this.playNotificationSound('join');
                    Toast.show(`${m.name} joined!`, 'success');
                  }
                });
                left.forEach(m => {
                  if (m.id !== this.userId) {
                    this.playNotificationSound('leave');
                    Toast.show(`${m.name} left.`, 'info');
                  }
                });
              }
              this.previousMembers = currentMembers;
              this.members = currentMembers;

              this.addToRecentUsers(this.members);
              this.updateSessionUI();
            }
          }
        } catch (e) { }
      }, 3000);
    },

    startGuestSync() {
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (this.pollInterval) clearInterval(this.pollInterval);
      document.body.classList.add('te-guest-mode');

      this.pollInterval = setInterval(async () => {
        if (!this.isActive) return;
        try {
          const session = await this.firebaseRead('sessions/' + this.sessionId);

          // Check if session ended
          if (!session) {
            Toast.show('Session ended', 'info');
            this.leaveSession(true);
            return;
          }

          // Host Transfer Check
          if (session.host === this.userId) {
            this.isHost = true;
            this.startHostSync();
            Toast.show('You are now the Host! 👑', 'success');
            return;
          }

          if (session.members) {
            // Check if I was kicked
            if (!session.members[this.userId]) {
              this.leaveSession();
              Toast.show('You have been kicked from the session.', 'error');
              return;
            }

            const currentMembers = Object.entries(session.members).map(([id, v]) => ({
              id,
              ...v,
              isHost: id === session.host
            }));

            // Diffing for Notifications (Guest Side)
            if (this.previousMembers.length > 0) {
              const joined = currentMembers.filter(c => !this.previousMembers.find(p => p.id === c.id));
              const left = this.previousMembers.filter(p => !currentMembers.find(c => c.id === p.id));

              joined.forEach(m => {
                if (m.id !== this.userId) {
                  this.playNotificationSound('join');
                  Toast.show(`${m.name} joined!`, 'success');
                }
              });
              left.forEach(m => {
                if (m.id !== this.userId) {
                  this.playNotificationSound('leave');
                  Toast.show(`${m.name} left.`, 'info');
                }
              });
            }
            this.previousMembers = currentMembers;
            this.members = currentMembers;

            if (session.playback) {
              this.applyPlaybackState(session.playback);
            }

            this.updateSessionUI();
          } else {
            // Fallback if members list gets wiped (rare) but user still connected?
            // Usually implies kicked or session error
          }
        } catch (e) { }
      }, 2000);
    },

    async leaveSession(ended = false) {
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (this.pollInterval) clearInterval(this.pollInterval);
      if (!ended && this.sessionId) {
        try { if (this.isHost) await this.firebaseDelete('sessions/' + this.sessionId); else await this.firebaseDelete('sessions/' + this.sessionId + '/members/' + this.userId); } catch (e) { }
      }
      this.sessionId = null; this.isHost = false; this.isActive = false; this.members = [];
      document.body.classList.remove('te-guest-mode');
      if (!ended) Toast.show('Left session', 'info');
      this.updateSessionUI();
    },

    async applyPlaybackState(state) {
      if (this.isHost) return;
      if (state.nextTrack) this.remoteNextTrack = state.nextTrack;
      if (!state.uri) return;
      try {
        const p = Spicetify.Player;
        if (p.data?.item?.uri !== state.uri) await Spicetify.Platform.PlayerAPI.play({ uri: state.uri }, {});
        const expected = state.pos + (Date.now() - state.ts);
        if (Math.abs(p.getProgress() - expected) > 3000) p.seek(expected);
        if (state.playing && !p.isPlaying()) p.play();
        else if (!state.playing && p.isPlaying()) p.pause();
      } catch (e) { }
    },

    showSyncModal() {
      const existing = document.getElementById('sync-modal');
      if (existing) existing.remove();

      const m = document.createElement('div');
      m.id = 'sync-modal';
      m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;';

      const url = localStorage.getItem('te-firebase-url') || DEFAULT_FIREBASE_URL;

      m.innerHTML = `<div style="background:linear-gradient(135deg,#1f1f33,#16213e);padding:32px;border-radius:16px;width:350px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.6);border:1px solid #333;position:relative;">
              <button id="te-sync-close" style="position:absolute;top:15px;right:15px;background:none;border:none;color:#666;font-size:24px;cursor:pointer;">&times;</button>
              
              <div id="te-live-badge" style="position:absolute;top:15px;left:15px;background:#ff0000;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:bold;display:none;align-items:center;gap:4px;">
                <span style="display:block;width:6px;height:6px;background:#fff;border-radius:50%;animation:pulse 1.5s infinite;"></span> LIVE
              </div>

              <h2 style="margin:0 0 8px;color:#fff;">Sync Session</h2>
              <p style="color:#aaa;font-size:12px;margin-bottom:24px;">Listen together in real-time</p>
        ${!this.isActive ? `
          <div style="margin-bottom:24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
               <label style="display:block;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Firebase Database URL</label>
               <button id="sm-firebase-guide" style="background:#333;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="How to get a URL">?</button>
            </div>
            <div style="display:flex;gap:8px;">
              <input type="text" id="sm-url" value="${url}" placeholder="https://..." style="flex:1;padding:10px 14px;background:#2a2a2a;color:#fff;border:1px solid transparent;border-radius:4px;font-size:13px;outline:none;transition:border 0.2s;" onfocus="this.style.border='1px solid #fff'" onblur="this.style.border='1px solid transparent'">
              <button id="sm-save-url" style="padding:0 16px;background:#333;color:#fff;border:none;border-radius:4px;font-weight:700;font-size:12px;cursor:pointer;transition:background 0.2s;">Save</button>
            </div>
          </div>
          
          <button id="sm-create" style="width:100%;padding:14px;background:#1db954;color:#000;border:none;border-radius:500px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase;transition:transform 0.1s;margin-bottom:24px;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">Start Session</button>
          
          <div style="position:relative;text-align:center;margin-bottom:24px;">
            <hr style="border:0;border-top:1px solid #282828;">
            <span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#121212;padding:0 12px;color:#b3b3b3;font-size:11px;font-weight:bold;letter-spacing:1px;">OR JOIN</span>
          </div>

          <div style="display:flex;gap:8px;">
            <input type="text" id="sm-code" placeholder="ENTER CODE" maxlength="6" style="flex:1;padding:12px;background:#2a2a2a;color:#fff;border:1px solid transparent;border-radius:4px;font-size:14px;text-align:center;letter-spacing:2px;text-transform:uppercase;outline:none;">
            <button id="sm-join" style="padding:0 32px;background:#fff;color:#000;border:none;border-radius:500px;font-weight:700;font-size:13px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;transition:opacity 0.2s;">JOIN</button>
          </div>
        ` : `
          <div style="text-align:center;margin-bottom:24px;background:#181818;padding:24px;border-radius:8px;">
            <div style="color:#b3b3b3;font-size:11px;font-weight:700;letter-spacing:1px;uppercase;margin-bottom:8px;">${this.isHost ? 'YOU ARE HOSTING' : 'CONNECTED TO SESSION'}</div>
            <div id="sm-code-display" style="font-size:42px;font-weight:900;color:#1db954;letter-spacing:8px;margin-bottom:16px;font-family:monospace;cursor:pointer;transition:transform 0.1s;" title="Click to Copy">
              ${this.sessionId}
            </div>
            
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${this.members.map(m => `
                <div style="display:flex;align-items:center;justify-content:space-between;background:#282828;padding:8px 12px;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:14px;color:#fff;font-weight:500;">${m.name}</span>
                    ${m.isHost ? '<span style="background:#1db954;color:#000;padding:2px 6px;border-radius:10px;font-size:9px;font-weight:bold;">HOST</span>' : ''}
                  </div>
                  <div style="display:flex;gap:5px;">
                      ${this.isHost && !m.isHost ? `
                          <button class="make-host-btn" data-id="${m.id}" data-name="${m.name}" style="background:transparent;border:1px solid #b3b3b3;color:#b3b3b3;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;font-weight:700;" title="Make Host">👑</button>
                          <button class="kick-btn" data-id="${m.id}" style="background:transparent;border:1px solid #e94560;color:#e94560;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;font-weight:700;" title="Kick User">👢</button>
                      ` : ''}
                      ${m.id === this.userId ? '<span style="color:#b3b3b3;font-size:10px;">(YOU)</span>' : ''}
                  </div>
                </div>
              `).join('')}
            </div>
            
            <button id="sm-invite-recent" style="margin-top:10px;width:100%;padding:8px;background:#2a2a2a;color:#b3b3b3;border:1px dashed #666;border-radius:4px;font-size:11px;cursor:pointer;">+ Invite Previous Users</button>
          </div>
          
          <div style="display:flex;gap:12px;">
             <button id="sm-share" style="flex:1;padding:12px;background:#282828;color:#fff;border:none;border-radius:500px;font-weight:700;font-size:13px;cursor:pointer;transition:background 0.2s;">Copy Invite</button>
             <button id="sm-leave" style="flex:1;padding:12px;background:transparent;color:#b3b3b3;border:1px solid #b3b3b3;border-radius:500px;font-weight:700;font-size:13px;cursor:pointer;transition:border-color 0.2s;">Leave</button>
          </div>
        `}
        <button id="sm-close" style="width:100%;margin-top:24px;padding:8px;background:transparent;color:#b3b3b3;border:none;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;transition:color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#b3b3b3'">Close</button>
      </div>`;

      document.body.appendChild(m);
      m.querySelector('#sm-close').onclick = () => m.remove();
      // m.querySelector('#sm-logs').onclick = () => showLogsModal(); // Logs button removed
      m.onclick = (e) => { if (e.target === m) m.remove(); };

      if (!this.isActive) {
        // Firebase Guide Handler
        m.querySelector('#sm-firebase-guide').onclick = () => {
          const overlay = document.createElement('div');
          overlay.id = 'te-fb-guide-overlay';
          overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000000;display:flex;align-items:center;justify-content:center;';

          overlay.innerHTML = `
                <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border:2px solid #1db954;border-radius:16px;padding:24px;width:400px;max-width:90vw;text-align:center;">
                    <h3 style="color:#1db954;margin:0 0 16px;font-size:20px;">🔥 Firebase Setup</h3>
                    <div style="color:#e0e0e0;font-size:13px;line-height:1.5;text-align:left;background:#0f3460;padding:16px;border-radius:8px;margin-bottom:20px;max-height:300px;overflow-y:auto;">
                        1. Go to <a href="https://console.firebase.google.com/" target="_blank" style="color:#1db954;font-weight:bold;">Firebase Console</a>.<br>
                        2. <b>Create a Project</b> (Name can be anything).<br>
                        3. Click <b>"Build"</b> > <b>"Realtime Database"</b>.<br>
                        4. Click <b>"Create Database"</b>.<br>
                        5. Select location, then choose <b>"Start in Test Mode"</b>.<br>
                        6. Ensure rules are true/true.<br>
                        7. Copy the <b>Database URL</b> (starts with https://).<br>
                        8. Paste it here.
                    </div>
                    <button id="te-fb-guide-ok" style="padding:10px 30px;background:#1db954;color:#fff;border:none;border-radius:500px;font-weight:bold;cursor:pointer;font-size:14px;">Got it!</button>
                </div>
             `;

          document.body.appendChild(overlay);

          const close = () => overlay.remove();
          overlay.querySelector('#te-fb-guide-ok').onclick = close;
          overlay.onclick = (e) => { if (e.target === overlay) close(); };
        };

        // Save URL handler
        m.querySelector('#sm-save-url').onclick = () => {
          const u = m.querySelector('#sm-url').value.trim();
          if (this.setFirebaseUrl(u)) {
            m.querySelector('#sm-save-url').textContent = 'Saved!';
            setTimeout(() => { if (m.querySelector('#sm-save-url')) m.querySelector('#sm-save-url').textContent = 'Save'; }, 2000);
          }
        };

        m.querySelector('#sm-create').onclick = async () => {
          const u = m.querySelector('#sm-url').value.trim();
          if (u && (u.includes('firebaseio.com') || u.includes('firebasedatabase.app'))) { localStorage.setItem('te-firebase-url', u); this.baseUrl = u; }
          m.remove();
          await this.createSession();
          this.showSyncModal();
        };
        m.querySelector('#sm-join').onclick = async () => {
          const u = m.querySelector('#sm-url').value.trim();
          if (u && (u.includes('firebaseio.com') || u.includes('firebasedatabase.app'))) { localStorage.setItem('te-firebase-url', u); this.baseUrl = u; }
          const code = m.querySelector('#sm-code').value;
          m.remove();
          await this.joinSession(code);
          this.showSyncModal();
        };
      } else {
        m.querySelector('#sm-leave').onclick = async () => { m.remove(); await this.leaveSession(); this.showSyncModal(); };
        m.querySelector('#sm-share').onclick = () => {
          const inviteText = `🎵 Join my Spotify Session!\n\n1️⃣ Server: ${this.baseUrl}\n2️⃣ Code: ${this.sessionId}`;
          navigator.clipboard.writeText(inviteText);
          Toast.show('Invite copied to clipboard! 📋', 'success');
        };

        // Handle Make Host clicks
        m.querySelectorAll('.make-host-btn').forEach(btn => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            this.transferHost(id, name);
          };
        });

        // Handle Kick clicks
        m.querySelectorAll('.kick-btn').forEach(btn => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            this.kickUser(id);
          };
        });

        // Handle Invite Recent
        const inviteBtn = m.querySelector('#sm-invite-recent');
        if (inviteBtn) {
          inviteBtn.onclick = () => {
            const recent = JSON.parse(localStorage.getItem('te-recent-users') || '[]');
            if (recent.length === 0) { Toast.show('No recent users found', 'info'); return; }

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999999;display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = `
                    <div style="background:#181818;padding:24px;border-radius:8px;width:300px;border:1px solid #333;">
                        <h3 style="color:#fff;margin:0 0 16px;">Invite User</h3>
                        <div style="display:flex;flex-direction:column;gap:8px;">
                            ${recent.map(u => `
                                <div style="display:flex;justify-content:space-between;align-items:center;background:#282828;padding:8px;border-radius:4px;">
                                    <span style="color:#fff;">${sanitizeText(u.name)}</span>
                                    <button class="do-invite-btn" data-id="${u.id}" style="background:#1db954;color:#000;border:none;border-radius:4px;padding:4px 12px;font-weight:bold;cursor:pointer;">Send</button>
                                </div>
                            `).join('')}
                        </div>
                        <button id="close-invites" style="margin-top:16px;width:100%;padding:8px;background:transparent;color:#888;border:none;cursor:pointer;">Close</button>
                    </div>
                `;
            document.body.appendChild(overlay);
            overlay.querySelector('#close-invites').onclick = () => overlay.remove();
            overlay.querySelectorAll('.do-invite-btn').forEach(b => {
              b.onclick = () => {
                this.inviteUser(b.getAttribute('data-id'));
                b.textContent = 'Sent';
                b.disabled = true;
                b.style.background = '#555';
              };
            });
          };
        }

        // Click to Copy Code
        const codeDisplay = m.querySelector('#sm-code-display');
        if (codeDisplay) {
          codeDisplay.onclick = () => {
            navigator.clipboard.writeText(this.sessionId);
            const originalColor = codeDisplay.style.color;
            codeDisplay.style.color = '#fff';
            codeDisplay.style.transform = 'scale(1.1)';
            Toast.show('Code copied! 📋', 'success');
            setTimeout(() => {
              codeDisplay.style.color = originalColor;
              codeDisplay.style.transform = 'scale(1)';
            }, 300);
          };
        }
      }
    },

    /**
     * Update session UI in Theme Editor panel
     */
    updateSessionUI() {
      const statusEl = document.getElementById('te-sync-status');
      const membersEl = document.getElementById('te-sync-members');
      const codeEl = document.getElementById('te-sync-code');
      const createBtn = document.getElementById('te-sync-create');
      const joinSection = document.getElementById('te-sync-join-section');
      const leaveBtn = document.getElementById('te-sync-leave');
      const activeSection = document.getElementById('te-sync-active');
      const liveBadge = document.getElementById('te-live-badge'); // Get the live badge

      if (!statusEl) return;

      if (this.isActive) {
        statusEl.textContent = this.isHost ? '🟢 Hosting Session' : '🟢 Connected';
        statusEl.style.color = '#1db954';

        if (codeEl) codeEl.textContent = this.sessionId;
        if (membersEl) {
          membersEl.innerHTML = this.members.map(m =>
            `<span style="background:${m.isHost ? '#1db954' : '#0f3460'};padding:2px 8px;border-radius:12px;font-size:11px;margin-right:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;">${m.isHost ? '👑 ' : ''}${sanitizeText(m.name)}</span>`
          ).join('');
        }

        // Toggle Live badge visibility
        if (liveBadge) {
          if (this.members.length > 1) {
            liveBadge.style.display = 'flex';
          } else {
            liveBadge.style.display = 'none';
          }
        }

        if (createBtn) createBtn.style.display = 'none';
        if (joinSection) joinSection.style.display = 'none';
        if (activeSection) activeSection.style.display = 'block';
        if (leaveBtn) leaveBtn.style.display = 'block';
      } else {
        statusEl.textContent = '⚪ Not Connected';
        statusEl.style.color = '#666';

        if (liveBadge) liveBadge.style.display = 'none'; // Hide badge if not active

        if (createBtn) createBtn.style.display = 'block';
        if (joinSection) joinSection.style.display = 'flex';
        if (activeSection) activeSection.style.display = 'none';
        if (leaveBtn) leaveBtn.style.display = 'none';
      }
    },

    /**
     * Set Firebase URL
     */
    setFirebaseUrl(url) {
      addLog('setFirebaseUrl called with: ' + url);
      if (url && (url.includes('firebaseio.com') || url.includes('firebasedatabase.app'))) {
        localStorage.setItem('te-firebase-url', url);
        FIREBASE_CONFIG.databaseURL = url;
        addLog('Firebase URL saved to localStorage');
        addLog('FIREBASE_CONFIG.databaseURL is now: ' + FIREBASE_CONFIG.databaseURL);
        Toast.show('Firebase URL saved! ✅', 'success');
        return true;
      }
      addLog('Invalid Firebase URL - must contain firebaseio.com or firebasedatabase.app');
      Toast.show('Invalid Firebase URL', 'error');
      return false;
    },

    /**
     * Get saved Firebase URL
     */
    getFirebaseUrl() {
      return localStorage.getItem('te-firebase-url') || DEFAULT_FIREBASE_URL;
    }
  };

  // Create Sync button in player bar
  const createSyncButton = () => {
    const check = setInterval(() => {
      const bar = document.querySelector('.main-nowPlayingBar-extraControls, .Y6soMMBElF7EQDbJv8Xb, [class*="extraControls"]');
      if (bar && !document.getElementById('sync-session-btn')) {
        clearInterval(check);
        const btn = document.createElement('button');
        btn.id = 'sync-session-btn';
        btn.title = 'Sync Session';
        // Use standard Spotify button classes if possible, but for custom element we style manually to match.
        // Default: var(--spice-subtext) (Grey), Hover: var(--spice-text) (White), Active: #1db954 (Green)
        btn.style.cssText = 'margin-right:0px;padding:8px;background:transparent !important;border:none !important;cursor:pointer;color:var(--spice-subtext);border-radius:50%;transition:transform 0.2s, color 0.2s;display:flex;align-items:center;justify-content:center;';

        btn.onmouseover = () => {
          btn.style.transform = 'scale(1.1)';
          // Active = Green. Inactive + Hover = White.
          btn.style.color = SyncSession.isActive ? '#1db954' : 'var(--spice-text)';
        };

        btn.onmouseout = () => {
          btn.style.transform = 'scale(1)';
          // Active = Green. Inactive + no hover = Grey.
          btn.style.color = SyncSession.isActive ? '#1db954' : 'var(--spice-subtext)';
        };

        btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" style="width:16px;height:16px;"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/><path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

        btn.onclick = () => SyncSession.showSyncModal();
        bar.insertBefore(btn, bar.firstChild);
        addLog('Sync button added to player bar');

        // Update button color when session is active and check for external changes
        setInterval(() => {
          btn.title = SyncSession.isActive ? 'Sync Session (Connected)' : 'Sync Session';
          // Only force update color if NOT hovering, to avoid flickering during hover
          if (!btn.matches(':hover')) {
            btn.style.color = SyncSession.isActive ? '#1db954' : 'var(--spice-subtext)';
          }
        }, 1000);
      }
    }, 1000);
  };

  // ==========================================================================================
  // 🔐 MODULE: DEFAULT CONFIGURATION (Single Source of Truth)
  // ==========================================================================================
  const DEFAULT_CONFIG = {
    radiusSidebar: 10, radiusMain: 10, radiusNowPlaying: 10, radiusPlayer: 10, panelRadius: 12,
    mode: 'Normal', preset: 'Default', fontFamily: 'Default', fontSize: 16, animationSpeed: 5, glowIntensity: 10,
    progressBarHeight: 4, showNextSong: false, autoPlayOnStart: false, performanceMode: false,
    hidePlaylistCover: false, hideMadeForYou: false, hideLikedSongsCard: false, hideRecentlyPlayed: false, hideFullscreenCard: false,
    hideProfileUsername: false, hideRecentSearches: false, hideDownloadButton: false, hideWhatsNew: false, hideFriendActivity: false,
    hideAudiobooks: false, hideMiniPlayer: false, hideFullscreenButton: false, declutterNowPlaying: false, hidePodcasts: false,
    hidePlayCount: false, disableHomeRecommendations: false, hideConnectBar: false, hideArtistCredits: false, smallerSidebarCover: false, hideFilterChips: false,
    hidePlayCount: false, disableHomeRecommendations: false, hideConnectBar: false, hideArtistCredits: false, smallerSidebarCover: false, hideFilterChips: false,
    characterLeft: 'none',
    characterRight: 'none',
    gifScale: 1,
    maxNameLength: 15,
    playerBarStyle: 'default', playerBarBlur: false, playerBarGradient: false, playerBarTransparent: false,
    customColors: { main: '', sidebar: '', player: '', text: '', button: '' },
    customPresets: {},
    customGifs: {}, // User-added GIFs
  };

  // ==========================================================================================
  // 🛠️ MODULE: UTILITIES (Debouncing, Sanitization, Cleanup Management)
  // ==========================================================================================

  /**
   * Sanitizes a URL to prevent XSS attacks
   * @param {string} url - The URL to sanitize
   * @returns {string} The sanitized URL
   */
  const sanitizeUrl = (url) => {
    if (typeof url !== 'string') return '';
    try {
      // Only allow http, https, and spotify protocols
      const parsed = new URL(url, window.location.origin);
      if (['http:', 'https:', 'spotify:'].includes(parsed.protocol)) {
        return parsed.href;
      }
      return '';
    } catch {
      // If URL parsing fails, encode it safely
      return encodeURI(url);
    }
  };

  /**
   * Sanitizes text to prevent XSS attacks by escaping HTML entities
   * @param {string} text - The text to sanitize
   * @returns {string} The sanitized text
   */
  const sanitizeText = (text) => {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  /**
   * Creates a debounced version of a function
   * @param {Function} func - The function to debounce
   * @param {number} wait - The debounce delay in milliseconds
   * @returns {Function} The debounced function
   */
  const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  /**
   * Input validators for configuration values
   * @namespace Validators
   */
  const Validators = {
    fontSize: (val) => Math.min(30, Math.max(10, parseInt(val) || 16)),
    radius: (val) => Math.min(50, Math.max(0, parseInt(val) || 10)),
    animationSpeed: (val) => Math.min(15, Math.max(0.5, parseFloat(val) || 5)),
    progressBarHeight: (val) => Math.min(20, Math.max(2, parseInt(val) || 4)),
    glowIntensity: (val) => Math.min(50, Math.max(0, parseInt(val) || 10)),
    panelRadius: (val) => Math.min(30, Math.max(0, parseInt(val) || 12)),
    gifScale: (val) => Math.min(20, Math.max(0.1, parseFloat(val) || 1))
  };

  /**
   * Toast notification system for user feedback
   * @namespace Toast
   */
  const Toast = {
    container: null,

    init() {
      if (this.container) return;
      this.container = document.createElement('div');
      this.container.id = 'te-toast-container';
      this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
      document.body.appendChild(this.container);
    },

    /**
     * Shows a toast notification
     * @param {string} message - The message to display
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duration in ms (default 3000)
     */
    show(message, type = 'success', duration = 3000) {
      this.init();
      const toast = document.createElement('div');
      const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
      const colors = {
        success: 'linear-gradient(135deg, #1db954, #1ed760)',
        error: 'linear-gradient(135deg, #e94560, #ff6b6b)',
        warning: 'linear-gradient(135deg, #f39c12, #f1c40f)',
        info: 'linear-gradient(135deg, #3498db, #5dade2)'
      };

      toast.style.cssText = `
                background: ${colors[type] || colors.info};
                color: white;
                padding: 12px 20px;
                border-radius: 10px;
                font-family: 'Segoe UI', sans-serif;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                gap: 10px;
                pointer-events: auto;
                animation: te-toast-in 0.3s ease forwards;
                max-width: 300px;
            `;
      toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${sanitizeText(message)}</span>`;

      // Add animation keyframes if not exists
      if (!document.getElementById('te-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'te-toast-styles';
        style.textContent = `
                    @keyframes te-toast-in { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
                    @keyframes te-toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
                `;
        document.head.appendChild(style);
      }

      this.container.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'te-toast-out 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  };

  /**
   * Undo/Redo history manager for configuration changes
   * @namespace HistoryManager
   */
  const HistoryManager = {
    history: [],
    currentIndex: -1,
    maxSize: 50,
    isUndoRedo: false,

    /**
     * Pushes a new state to history
     * @param {Object} state - The state to save
     */
    push(state) {
      if (this.isUndoRedo) return;
      // Remove future states if we're not at the end
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1);
      }
      this.history.push(JSON.stringify(state));
      if (this.history.length > this.maxSize) {
        this.history.shift();
      }
      this.currentIndex = this.history.length - 1;
    },

    /**
     * Undoes the last change
     * @returns {Object|null} The previous state or null
     */
    undo() {
      if (!this.canUndo()) return null;
      this.currentIndex--;
      return JSON.parse(this.history[this.currentIndex]);
    },

    /**
     * Redoes the last undone change
     * @returns {Object|null} The next state or null
     */
    redo() {
      if (!this.canRedo()) return null;
      this.currentIndex++;
      return JSON.parse(this.history[this.currentIndex]);
    },

    canUndo() { return this.currentIndex > 0; },
    canRedo() { return this.currentIndex < this.history.length - 1; },

    /**
     * Gets current undo/redo status
     * @returns {Object} Status object with canUndo and canRedo
     */
    getStatus() {
      return { canUndo: this.canUndo(), canRedo: this.canRedo() };
    }
  };

  /**
   * Manages cleanup of intervals, observers, and event listeners
   */
  const CleanupManager = {
    intervals: [],
    observers: [],
    listeners: [],

    /**
     * Registers an interval for cleanup
     * @param {number} intervalId - The interval ID to track
     */
    addInterval(intervalId) {
      this.intervals.push(intervalId);
    },

    /**
     * Registers a MutationObserver for cleanup
     * @param {MutationObserver} observer - The observer to track
     */
    addObserver(observer) {
      this.observers.push(observer);
    },

    /**
     * Registers an event listener for cleanup
     * @param {EventTarget} target - The target element
     * @param {string} event - The event name
     * @param {Function} handler - The event handler
     */
    addListener(target, event, handler) {
      this.listeners.push({ target, event, handler });
    },

    /**
     * Cleans up all registered resources
     */
    cleanup() {
      this.intervals.forEach(id => clearInterval(id));
      this.observers.forEach(obs => obs.disconnect());
      this.listeners.forEach(({ target, event, handler }) => {
        target.removeEventListener(event, handler);
      });
      this.intervals = [];
      this.observers = [];
      this.listeners = [];
    }
  };

  // Register cleanup on page unload
  window.addEventListener('beforeunload', () => CleanupManager.cleanup());

  /**
   * GIF Preloader - Lazy loads GIFs only when needed
   * @namespace GifPreloader
   */
  const GifPreloader = {
    cache: new Map(),
    loading: new Map(),

    /**
     * Preloads a GIF and caches it
     * @param {string} url - The GIF URL to preload
     * @returns {Promise<string>} The loaded URL
     */
    preload(url) {
      if (!url) return Promise.resolve('');
      if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
      if (this.loading.has(url)) return this.loading.get(url);

      const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.cache.set(url, url);
          this.loading.delete(url);
          resolve(url);
        };
        img.onerror = () => {
          this.loading.delete(url);
          resolve('');
        };
        img.src = url;
      });

      this.loading.set(url, promise);
      return promise;
    },

    /**
     * Gets a cached GIF URL or empty string
     * @param {string} url - The GIF URL
     * @returns {string} The cached URL or empty string
     */
    get(url) {
      return this.cache.get(url) || '';
    },

    /**
     * Checks if a GIF is cached
     * @param {string} url - The GIF URL
     * @returns {boolean} Whether the GIF is cached
     */
    has(url) {
      return this.cache.has(url);
    },

    /**
     * Clears the GIF cache
     */
    clear() {
      this.cache.clear();
      this.loading.clear();
    }
  };

  /**
   * Performance utilities for batching DOM updates
   * @namespace PerformanceUtils
   */
  const PerformanceUtils = {
    rafId: null,
    pendingUpdates: [],

    /**
     * Schedules a function to run on the next animation frame
     * Batches multiple updates together for performance
     * @param {Function} fn - The function to schedule
     */
    scheduleUpdate(fn) {
      this.pendingUpdates.push(fn);

      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          const updates = [...this.pendingUpdates];
          this.pendingUpdates = [];
          this.rafId = null;

          updates.forEach(update => {
            try {
              update();
            } catch (e) {
              console.warn('[Theme Editor] Update failed:', e.message);
            }
          });
        });
      }
    },

    /**
     * Batches multiple CSS property changes into a single update
     * @param {HTMLElement} element - The target element
     * @param {Object} styles - Object with CSS property-value pairs
     */
    batchStyleUpdate(element, styles) {
      this.scheduleUpdate(() => {
        Object.entries(styles).forEach(([prop, value]) => {
          element.style[prop] = value;
        });
      });
    },

    /**
     * Batches CSS variable updates to :root
     * @param {Object} variables - Object with CSS variable-value pairs
     */
    batchCSSVariables(variables) {
      this.scheduleUpdate(() => {
        const root = document.documentElement;
        Object.entries(variables).forEach(([prop, value]) => {
          root.style.setProperty(prop, value);
        });
      });
    }
  };

  // ==========================================================================================
  // 📚 MODULE: CONSTANTS (Fonts & Presets from Code 1)
  // ==========================================================================================
  const Constants = {
    FONTS: [
      { name: 'Default', value: '' },
      { name: 'Tajawal', value: 'Tajawal, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap' },
      { name: 'Cairo', value: 'Cairo, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap' },
      { name: 'Aref Ruqaa', value: '"Aref Ruqaa", serif', url: 'https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@400;700&display=swap' },
      { name: 'Reem Kufi', value: '"Reem Kufi", sans-serif', url: 'https://fonts.googleapis.com/css2?family=Reem+Kufi:wght@400;700&display=swap' },
      { name: 'Lemonada', value: 'Lemonada, cursive', url: 'https://fonts.googleapis.com/css2?family=Lemonada:wght@400;700&display=swap' },
      { name: 'El Messiri', value: '"El Messiri", sans-serif', url: 'https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;700&display=swap' },
      { name: 'Changa', value: 'Changa, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Changa:wght@400;700&display=swap' },
      { name: 'Almarai', value: 'Almarai, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Almarai:wght@400;700&display=swap' },
      { name: 'Noto Naskh Arabic', value: '"Noto Naskh Arabic", serif', url: 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap' },
      { name: 'Amiri', value: 'Amiri, serif', url: 'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap' },
      { name: 'Roboto', value: 'Roboto, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap' },
      { name: 'Open Sans', value: '"Open Sans", sans-serif', url: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap' },
      { name: 'Inter', value: 'Inter, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' },
      { name: 'Poppins', value: 'Poppins, sans-serif', url: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap' },
      { name: 'Pacifico', value: 'Pacifico, cursive', url: 'https://fonts.googleapis.com/css2?family=Pacifico&display=swap' },
      { name: 'Dancing Script', value: '"Dancing Script", cursive', url: 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap' },
      { name: 'Satisfy', value: 'Satisfy, cursive', url: 'https://fonts.googleapis.com/css2?family=Satisfy&display=swap' },
      { name: 'Caveat', value: 'Caveat, cursive', url: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap' },
    ],
    PRESETS: {
      'Default': {},

      '🎵 Song Color': 'DYNAMIC',
      'Deep Dark': { '--spice-main': '#000000', '--spice-sidebar': '#0a0a0a', '--spice-player': '#050505', '--spice-card': '#0a0a0a', '--spice-shadow': 'rgba(0,0,0,0.9)', '--spice-text': '#e0e0e0', '--spice-subtext': '#a0a0a0', '--spice-button': '#1a1a1a', '--spice-button-active': '#282828', '--spice-notification': '#1db954' },
      'Pure Black AMOLED': { '--spice-main': '#000000', '--spice-sidebar': '#000000', '--spice-player': '#000000', '--spice-card': '#111111', '--spice-text': '#ffffff', '--spice-subtext': '#888888', '--spice-button': '#111111', '--spice-button-active': '#222222' },
      'Dark White': { '--spice-main': '#1a1a1a', '--spice-sidebar': '#111111', '--spice-player': '#0d0d0d', '--spice-text': '#ffffff', '--spice-subtext': '#b0b0b0', '--spice-button': '#ffffff', '--spice-button-active': '#e0e0e0' },
      'Ocean Blue': { '--spice-main': '#0a192f', '--spice-sidebar': '#020c1b', '--spice-player': '#0a192f', '--spice-text': '#ccd6f6', '--spice-subtext': '#8892b0', '--spice-button': '#64ffda', '--spice-button-active': '#4fd1c5' },
      'Sunset Vibes': { '--spice-main': '#1a1423', '--spice-sidebar': '#0f0c14', '--spice-player': '#1a1423', '--spice-text': '#ffd6e0', '--spice-subtext': '#c9a0dc', '--spice-button': '#ff6b6b', '--spice-button-active': '#ee5253' },
      'Forest Green': { '--spice-main': '#0d1f0d', '--spice-sidebar': '#091409', '--spice-player': '#0d1f0d', '--spice-text': '#c6f6d5', '--spice-subtext': '#9ae6b4', '--spice-button': '#48bb78', '--spice-button-active': '#38a169' },
      'Purple Haze': { '--spice-main': '#1a0a2e', '--spice-sidebar': '#0f0519', '--spice-player': '#1a0a2e', '--spice-text': '#e9d5ff', '--spice-subtext': '#c4b5fd', '--spice-button': '#a855f7', '--spice-button-active': '#9333ea' },
      'Cyberpunk': { '--spice-main': '#0a0a0a', '--spice-sidebar': '#050505', '--spice-player': '#0a0a0a', '--spice-text': '#00ff9f', '--spice-subtext': '#ff00ff', '--spice-button': '#ffff00', '--spice-button-active': '#ff6600' },
      'Blood Red': { '--spice-main': '#1a0505', '--spice-sidebar': '#0d0202', '--spice-player': '#1a0505', '--spice-text': '#ff6b6b', '--spice-subtext': '#e74c3c', '--spice-button': '#c0392b', '--spice-button-active': '#a93226' },
      'Neon Pink': { '--spice-main': '#1a0a1a', '--spice-sidebar': '#0f050f', '--spice-player': '#1a0a1a', '--spice-text': '#ff69b4', '--spice-subtext': '#ff1493', '--spice-button': '#ff00ff', '--spice-button-active': '#da00da' },
      'Golden': { '--spice-main': '#1a1505', '--spice-sidebar': '#0f0d02', '--spice-player': '#1a1505', '--spice-text': '#ffd700', '--spice-subtext': '#f39c12', '--spice-button': '#e67e22', '--spice-button-active': '#d35400' },
      'Ice Blue': { '--spice-main': '#0a1520', '--spice-sidebar': '#050a10', '--spice-player': '#0a1520', '--spice-text': '#87ceeb', '--spice-subtext': '#00bfff', '--spice-button': '#1e90ff', '--spice-button-active': '#4169e1' },
      'Mint': { '--spice-main': '#0a1a15', '--spice-sidebar': '#050f0a', '--spice-player': '#0a1a15', '--spice-text': '#98ff98', '--spice-subtext': '#00fa9a', '--spice-button': '#00ff7f', '--spice-button-active': '#3cb371' },
      'Monochrome': { '--spice-main': '#1a1a1a', '--spice-sidebar': '#0a0a0a', '--spice-player': '#1a1a1a', '--spice-text': '#ffffff', '--spice-subtext': '#808080', '--spice-button': '#404040', '--spice-button-active': '#606060' },
      'Dracula': { '--spice-main': '#282a36', '--spice-sidebar': '#21222c', '--spice-player': '#282a36', '--spice-text': '#f8f8f2', '--spice-subtext': '#6272a4', '--spice-button': '#bd93f9', '--spice-button-active': '#ff79c6' },
      'Nord': { '--spice-main': '#2e3440', '--spice-sidebar': '#242933', '--spice-player': '#2e3440', '--spice-text': '#eceff4', '--spice-subtext': '#81a1c1', '--spice-button': '#88c0d0', '--spice-button-active': '#5e81ac' },
      'Gruvbox': { '--spice-main': '#1d2021', '--spice-sidebar': '#282828', '--spice-player': '#1d2021', '--spice-text': '#ebdbb2', '--spice-subtext': '#a89984', '--spice-button': '#fe8019', '--spice-button-active': '#fabd2f' },
      // ===== PREMIUM COLOR SCHEMES =====
      'Discord': { '--spice-main': '#23283D', '--spice-sidebar': '#1E2233', '--spice-player': '#101320', '--spice-card': '#101320', '--spice-text': '#FFFFFF', '--spice-subtext': '#B9BBBE', '--spice-button': '#7289DA', '--spice-button-active': '#5C6FB1', '--spice-shadow': '#1E2233', '--spice-notification': '#7289DA' },
      'Spotify Classic': { '--spice-main': '#121212', '--spice-sidebar': '#000000', '--spice-player': '#181818', '--spice-card': '#282828', '--spice-text': '#FFFFFF', '--spice-subtext': '#B3B3B3', '--spice-button': '#1DB954', '--spice-button-active': '#1ED760', '--spice-shadow': '#000000', '--spice-notification': '#4687D6' },
      'Mocha': { '--spice-main': '#181825', '--spice-sidebar': '#1E1E2E', '--spice-player': '#181825', '--spice-card': '#45475A', '--spice-text': '#CDD6F4', '--spice-subtext': '#BAC2DE', '--spice-button': '#89B4FA', '--spice-button-active': '#74C7EC', '--spice-shadow': '#585B70', '--spice-notification': '#89B4FA' },
      'Pine': { '--spice-main': '#1F1D2E', '--spice-sidebar': '#191724', '--spice-player': '#1F1D2E', '--spice-card': '#403D52', '--spice-text': '#E0DEF4', '--spice-subtext': '#908CAA', '--spice-button': '#EBBCBA', '--spice-button-active': '#EBBCBA', '--spice-shadow': '#524F67', '--spice-notification': '#9CCFD8' },
      'Moonlight': { '--spice-main': '#2A273F', '--spice-sidebar': '#232136', '--spice-player': '#2A273F', '--spice-card': '#44415A', '--spice-text': '#E0DEF4', '--spice-subtext': '#908CAA', '--spice-button': '#EA9A97', '--spice-button-active': '#EA9A97', '--spice-shadow': '#56526E', '--spice-notification': '#9CCFD8' },
      'Everforest': { '--spice-main': '#272E33', '--spice-sidebar': '#2E383C', '--spice-player': '#272E33', '--spice-card': '#374145', '--spice-text': '#D3C6AA', '--spice-subtext': '#9AA79D', '--spice-button': '#A7C080', '--spice-button-active': '#AEC984', '--spice-shadow': '#374145', '--spice-notification': '#86AF87' },
      'Sakura': { '--spice-main': '#171717', '--spice-sidebar': '#101010', '--spice-player': '#171717', '--spice-card': '#D68BA2', '--spice-text': '#FCB4CA', '--spice-subtext': '#FFDCDC', '--spice-button': '#FCB4CA', '--spice-button-active': '#D48AA0', '--spice-shadow': '#FCB4CA', '--spice-notification': '#FFFFFF' },
      'Vaporwave': { '--spice-main': '#171717', '--spice-sidebar': '#101010', '--spice-player': '#171717', '--spice-card': '#007F9E', '--spice-text': '#01CDFE', '--spice-subtext': '#EAFFFF', '--spice-button': '#01CDFE', '--spice-button-active': '#118BA8', '--spice-shadow': '#2EC2E6', '--spice-notification': '#FFFFFF' },
      'Mono': { '--spice-main': '#171717', '--spice-sidebar': '#101010', '--spice-player': '#171717', '--spice-card': '#343434', '--spice-text': '#FFFFFF', '--spice-subtext': '#B9BBBE', '--spice-button': '#FFFFFF', '--spice-button-active': '#C5C5C5', '--spice-shadow': '#595858', '--spice-notification': '#101010' },
      // ===== NEW THEME PRESETS =====
      'Tokyo Night': { '--spice-main': '#1a1b26', '--spice-sidebar': '#16161e', '--spice-player': '#1a1b26', '--spice-card': '#24283b', '--spice-text': '#c0caf5', '--spice-subtext': '#9aa5ce', '--spice-button': '#7aa2f7', '--spice-button-active': '#bb9af7', '--spice-shadow': '#414868', '--spice-notification': '#7aa2f7' },
      'Solarized Dark': { '--spice-main': '#002b36', '--spice-sidebar': '#073642', '--spice-player': '#002b36', '--spice-card': '#073642', '--spice-text': '#839496', '--spice-subtext': '#657b83', '--spice-button': '#268bd2', '--spice-button-active': '#2aa198', '--spice-shadow': '#073642', '--spice-notification': '#859900' },
      'One Dark': { '--spice-main': '#282c34', '--spice-sidebar': '#21252b', '--spice-player': '#282c34', '--spice-card': '#2c313a', '--spice-text': '#abb2bf', '--spice-subtext': '#5c6370', '--spice-button': '#61afef', '--spice-button-active': '#98c379', '--spice-shadow': '#21252b', '--spice-notification': '#e06c75' },
      'Material Dark': { '--spice-main': '#212121', '--spice-sidebar': '#1a1a1a', '--spice-player': '#212121', '--spice-card': '#2d2d2d', '--spice-text': '#eeffff', '--spice-subtext': '#b0bec5', '--spice-button': '#82aaff', '--spice-button-active': '#c3e88d', '--spice-shadow': '#1a1a1a', '--spice-notification': '#ff5370' },
      'Rose Pine': { '--spice-main': '#191724', '--spice-sidebar': '#1f1d2e', '--spice-player': '#191724', '--spice-card': '#26233a', '--spice-text': '#e0def4', '--spice-subtext': '#908caa', '--spice-button': '#ebbcba', '--spice-button-active': '#f6c177', '--spice-shadow': '#26233a', '--spice-notification': '#c4a7e7' },
      // ===== CATPPUCCIN VARIANTS =====
      'Catppuccin Latte': { '--spice-main': '#eff1f5', '--spice-sidebar': '#e6e9ef', '--spice-player': '#dce0e8', '--spice-card': '#ccd0da', '--spice-text': '#4c4f69', '--spice-subtext': '#6c6f85', '--spice-button': '#1e66f5', '--spice-button-active': '#8839ef', '--spice-shadow': '#bcc0cc', '--spice-notification': '#40a02b' },
      'Catppuccin Frappe': { '--spice-main': '#303446', '--spice-sidebar': '#292c3c', '--spice-player': '#232634', '--spice-card': '#414559', '--spice-text': '#c6d0f5', '--spice-subtext': '#a5adce', '--spice-button': '#8caaee', '--spice-button-active': '#ca9ee6', '--spice-shadow': '#51576d', '--spice-notification': '#a6d189' },
      'Catppuccin Macchiato': { '--spice-main': '#24273a', '--spice-sidebar': '#1e2030', '--spice-player': '#181926', '--spice-card': '#363a4f', '--spice-text': '#cad3f5', '--spice-subtext': '#a5adcb', '--spice-button': '#8aadf4', '--spice-button-active': '#c6a0f6', '--spice-shadow': '#494d64', '--spice-notification': '#a6da95' },
      'Catppuccin Mocha': { '--spice-main': '#1e1e2e', '--spice-sidebar': '#181825', '--spice-player': '#11111b', '--spice-card': '#313244', '--spice-text': '#cdd6f4', '--spice-subtext': '#a6adc8', '--spice-button': '#89b4fa', '--spice-button-active': '#cba6f7', '--spice-shadow': '#45475a', '--spice-notification': '#a6e3a1' },
      // ===== ATOM ONE VARIANTS =====
      'Atom One Dark': { '--spice-main': '#282c34', '--spice-sidebar': '#21252b', '--spice-player': '#1d1f23', '--spice-card': '#2c313c', '--spice-text': '#abb2bf', '--spice-subtext': '#5c6370', '--spice-button': '#61afef', '--spice-button-active': '#e06c75', '--spice-shadow': '#181a1f', '--spice-notification': '#98c379' },
      'Atom One Light': { '--spice-main': '#fafafa', '--spice-sidebar': '#f0f0f0', '--spice-player': '#e5e5e5', '--spice-card': '#eaeaea', '--spice-text': '#383a42', '--spice-subtext': '#a0a1a7', '--spice-button': '#4078f2', '--spice-button-active': '#e45649', '--spice-shadow': '#d4d4d4', '--spice-notification': '#50a14f' },
      // ===== ADDITIONAL PREMIUM THEMES =====
      'Palenight': { '--spice-main': '#292d3e', '--spice-sidebar': '#242837', '--spice-player': '#1f222d', '--spice-card': '#32374c', '--spice-text': '#a6accd', '--spice-subtext': '#676e95', '--spice-button': '#82aaff', '--spice-button-active': '#c792ea', '--spice-shadow': '#1c1f2b', '--spice-notification': '#c3e88d' },
      'Horizon': { '--spice-main': '#1c1e26', '--spice-sidebar': '#16161c', '--spice-player': '#232530', '--spice-card': '#2e303e', '--spice-text': '#e0e0e0', '--spice-subtext': '#6c6f93', '--spice-button': '#e95678', '--spice-button-active': '#fab795', '--spice-shadow': '#0f1014', '--spice-notification': '#29d398' },
      'Ayu Dark': { '--spice-main': '#0a0e14', '--spice-sidebar': '#0d1017', '--spice-player': '#080a0f', '--spice-card': '#0f131a', '--spice-text': '#b3b1ad', '--spice-subtext': '#626a73', '--spice-button': '#ffb454', '--spice-button-active': '#59c2ff', '--spice-shadow': '#050608', '--spice-notification': '#c2d94c' },
      'Ayu Mirage': { '--spice-main': '#1f2430', '--spice-sidebar': '#181c24', '--spice-player': '#161a22', '--spice-card': '#272d38', '--spice-text': '#cbccc6', '--spice-subtext': '#5c6773', '--spice-button': '#ffcc66', '--spice-button-active': '#73d0ff', '--spice-shadow': '#11141a', '--spice-notification': '#bae67e' },
      'Andromeda': { '--spice-main': '#23262e', '--spice-sidebar': '#1e2128', '--spice-player': '#1a1c22', '--spice-card': '#2b2f38', '--spice-text': '#d5ced9', '--spice-subtext': '#7e7e8f', '--spice-button': '#00e8c6', '--spice-button-active': '#ee5d43', '--spice-shadow': '#14161a', '--spice-notification': '#96e072' },
      'Shades of Purple': { '--spice-main': '#2d2b55', '--spice-sidebar': '#1e1e3f', '--spice-player': '#252047', '--spice-card': '#3d3b6d', '--spice-text': '#e0def4', '--spice-subtext': '#a599e9', '--spice-button': '#fad000', '--spice-button-active': '#ff628c', '--spice-shadow': '#16152b', '--spice-notification': '#9effff' },
      'Night Owl': { '--spice-main': '#011627', '--spice-sidebar': '#010e17', '--spice-player': '#001119', '--spice-card': '#0b2942', '--spice-text': '#d6deeb', '--spice-subtext': '#637777', '--spice-button': '#82aaff', '--spice-button-active': '#c792ea', '--spice-shadow': '#000a10', '--spice-notification': '#22da6e' },
      'Synthwave 84': { '--spice-main': '#262335', '--spice-sidebar': '#1f1a2e', '--spice-player': '#1a1527', '--spice-card': '#34294f', '--spice-text': '#f4eeff', '--spice-subtext': '#848bbd', '--spice-button': '#ff7edb', '--spice-button-active': '#fede5d', '--spice-shadow': '#120f1d', '--spice-notification': '#72f1b8' },
      'Cobalt2': { '--spice-main': '#193549', '--spice-sidebar': '#122738', '--spice-player': '#0d1926', '--spice-card': '#1f4662', '--spice-text': '#ffffff', '--spice-subtext': '#0088ff', '--spice-button': '#ffc600', '--spice-button-active': '#ff9d00', '--spice-shadow': '#0a1520', '--spice-notification': '#3ad900' },
      'GitHub Dark': { '--spice-main': '#0d1117', '--spice-sidebar': '#010409', '--spice-player': '#161b22', '--spice-card': '#21262d', '--spice-text': '#c9d1d9', '--spice-subtext': '#8b949e', '--spice-button': '#58a6ff', '--spice-button-active': '#1f6feb', '--spice-shadow': '#010409', '--spice-notification': '#3fb950' },
    }
  };

  // ==========================================================================================
  // ⚙️ MODULE: CONFIGURATION (Structure from Code 2)
  // ==========================================================================================

  /**
   * Configuration manager for theme settings
   * @namespace Config
   */
  const Config = {
    /** @type {Object} Default configuration values - uses DEFAULT_CONFIG constant */
    data: { ...DEFAULT_CONFIG },

    /**
     * Loads configuration from localStorage
     * @returns {void}
     */
    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
        if (saved) {
          this.data = { ...this.data, ...saved };
        }
        // Initialize history with loaded state
        HistoryManager.push({ ...this.data });
      } catch (e) {
        console.warn('[Theme Editor] Failed to load config from localStorage:', e.message);
      }
    },

    /**
     * Saves current configuration to localStorage
     * @returns {void}
     */
    save() {
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(this.data));
        Core.applyConfig();
      } catch (e) {
        console.error('[Theme Editor] Failed to save config:', e.message);
      }
    },

    /**
     * Gets a configuration value
     * @param {string} key - The configuration key
     * @returns {*} The configuration value
     */
    get(key) { return this.data[key]; },

    /**
     * Sets a configuration value with validation and saves
     * @param {string} key - The configuration key
     * @param {*} val - The value to set
     */
    set(key, val) {
      // Apply validation based on key type
      if (key === 'fontSize') {
        val = Validators.fontSize(val);
      } else if (key.includes('radius') || key.includes('Radius')) {
        val = Validators.radius(val);
      } else if (key === 'animationSpeed') {
        val = Validators.animationSpeed(val);
      } else if (key === 'progressBarHeight') {
        val = Validators.progressBarHeight(val);
      } else if (key === 'glowIntensity') {
        val = Validators.glowIntensity(val);
      } else if (key === 'gifScale') {
        val = Validators.gifScale(val);
      }

      // Save to history before making change (for undo)
      HistoryManager.push({ ...this.data });

      this.data[key] = val;
      this.save();
    },

    /**
     * Exports current configuration as JSON string
     * @returns {string} JSON configuration string
     */
    export() {
      return JSON.stringify(this.data, null, 2);
    },

    /**
     * Imports configuration from JSON string
     * @param {string} jsonStr - JSON string to import
     * @returns {boolean} Success status
     */
    import(jsonStr) {
      try {
        const imported = JSON.parse(jsonStr);
        if (typeof imported === 'object' && imported !== null) {
          HistoryManager.push({ ...this.data }); // Save before import
          this.data = { ...this.data, ...imported };
          this.save();
          return true;
        }
        return false;
      } catch (e) {
        console.error('[Theme Editor] Failed to import config:', e.message);
        return false;
      }
    },

    /**
     * Resets configuration to defaults
     */
    reset() {
      HistoryManager.push({ ...this.data }); // Save before reset
      this.data = { ...DEFAULT_CONFIG };
      this.save();
    },

    /**
     * Saves current settings as a custom preset
     * @param {string} name - Name for the custom preset
     * @returns {boolean} Success status
     */
    saveCustomPreset(name) {
      if (!name || typeof name !== 'string') return false;
      const safeName = sanitizeText(name.trim());
      if (!safeName) return false;

      const currentColors = { ...this.data.customColors };
      if (!this.data.customPresets) this.data.customPresets = {};
      this.data.customPresets[safeName] = {
        '--spice-main': currentColors.main || '#1a1a2e',
        '--spice-sidebar': currentColors.sidebar || '#16213e',
        '--spice-player': currentColors.player || '#0f3460',
        '--spice-text': currentColors.text || '#e0e0e0',
        '--spice-button': currentColors.button || '#e94560'
      };
      this.save();
      Toast.show(`Preset "${safeName}" saved! 💾`, 'success');
      return true;
    },

    /**
     * Deletes a custom preset
     * @param {string} name - Name of the preset to delete
     * @returns {boolean} Success status
     */
    deleteCustomPreset(name) {
      if (this.data.customPresets && this.data.customPresets[name]) {
        delete this.data.customPresets[name];
        this.save();
        Toast.show(`Preset "${name}" deleted! 🗑️`, 'info');
        return true;
      }
      return false;
    },

    /**
     * Undoes the last configuration change
     * @returns {boolean} Success status
     */
    undo() {
      const previousState = HistoryManager.undo();
      if (previousState) {
        HistoryManager.isUndoRedo = true;
        this.data = previousState;
        this.save();
        HistoryManager.isUndoRedo = false;
        Toast.show('Undo successful! ↶', 'info');
        return true;
      }
      Toast.show('Nothing to undo', 'warning');
      return false;
    },

    /**
     * Redoes the last undone configuration change
     * @returns {boolean} Success status
     */
    redo() {
      const nextState = HistoryManager.redo();
      if (nextState) {
        HistoryManager.isUndoRedo = true;
        this.data = nextState;
        this.save();
        HistoryManager.isUndoRedo = false;
        Toast.show('Redo successful! ↷', 'info');
        return true;
      }
      Toast.show('Nothing to redo', 'warning');
      return false;
    }
  };

  // ==========================================================================================
  // 🎨 MODULE: CORE CSS & THEME LOGIC (Exact Logic from Code 1)
  // ==========================================================================================
  const Core = {
    styleElement: null,

    init() {
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'theme-editor-styles';
      document.head.appendChild(this.styleElement);
    },

    injectCSS(css) { this.styleElement.innerHTML = css; },

    renderGifs() {
      let container = document.getElementById('te-gif-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'te-gif-container';
        container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden;';
        document.body.appendChild(container);
      }

      container.innerHTML = '';

      const config = Config.data;
      const baseSize = 100; // Base size for GIFs
      const scaledSize = baseSize * (config.gifScale || 1);

      const renderFixedGif = (charName, side) => {
        if (!charName || charName === 'none') return;
        const url = this.getCharacterUrl(charName);
        if (!url) return;

        const img = document.createElement('img');
        img.src = url;
        img.className = 'te-gif-item';
        img.style.cssText = `
            position: fixed;
            bottom: 0;
            ${side}: 10px;
            width: ${scaledSize}px;
            height: auto;
            pointer-events: none;
            z-index: 99999;
         `;
        container.appendChild(img);
      };

      renderFixedGif(config.characterLeft, 'left');
      renderFixedGif(config.characterRight, 'right');
    },

    loadFont(url) {
      if (!url) return;
      if (!document.querySelector(`link[href="${url}"]`)) {
        const link = document.createElement('link');
        link.href = url; link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
    },

    /**
     * Gets the URL for a character GIF, checking custom GIFs first
     * Uses GifPreloader for lazy loading and caching
     * @param {string} char - Character key
     * @returns {string} The GIF URL
     */
    getCharacterUrl(char) {
      // Built-in GIF URLs
      const builtInUrls = {
        'sonic': EXTENSION_CONFIG.ASSETS.GIFS.SONIC,
        'jumping': EXTENSION_CONFIG.ASSETS.GIFS.JUMPING,
        'duck': EXTENSION_CONFIG.ASSETS.GIFS.DUCK,
        'oneko': EXTENSION_CONFIG.ASSETS.GIFS.ONEKO
      };

      // Check custom GIFs first
      const customGifs = Config.data.customGifs || {};
      let url = customGifs[char] ? sanitizeUrl(customGifs[char]) : (builtInUrls[char] || '');

      if (!url) return '';

      // Use lazy loading - preload if not cached
      if (!GifPreloader.has(url)) {
        GifPreloader.preload(url);
      }

      return url;
    },

    /**
     * Preloads all active character GIFs
     * Called when config changes to prepare GIFs before CSS injection
     */
    preloadActiveGifs() {
      const config = Config.data;
      if (config.activeGifs) {
        config.activeGifs.forEach(g => {
          if (g.enabled && g.url) {
            const url = this.getCharacterUrl(g.url) || sanitizeUrl(g.url);
            if (url) GifPreloader.preload(url);
          }
        });
      }
    },

    /**
     * Applies the current configuration to the Spotify UI
     * Generates and injects CSS for all theme settings including:
     * - Border radius values for UI elements
     * - Font settings (family and size)
     * - Animation speeds for hover effects
     * - Color presets and dynamic song colors
     * - Performance mode optimizations
     * - Player bar styles and effects
     * - Hide/show element toggles
     * - Character GIF overlays
     * Uses PerformanceUtils for optimized DOM updates
     * @returns {void}
     */
    applyConfig() {
      // Preload active GIFs before applying config
      this.preloadActiveGifs();

      const config = Config.data; // Using Code 1's variable name for easier logic mapping
      const speed = config.animationSpeed;
      const glow = config.glowIntensity;
      const pbHeight = config.progressBarHeight || 4;

      // Build CSS string
      let css = `:root { --te-radius-sidebar: ${config.radiusSidebar}px; --te-radius-main: ${config.radiusMain}px; --te-radius-nowplaying: ${config.radiusNowPlaying}px; --te-radius-player: ${config.radiusPlayer}px; --te-font-size: ${config.fontSize}px; --te-anim-speed: ${speed}s; --te-glow: ${glow}px; --te-progress-height: ${pbHeight}px; }
            *, *::before, *::after { transition: background-color 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), color 0.3s ease, border-color 0.4s ease, border-radius 0.3s ease, box-shadow 0.4s ease, transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s ease !important; }`

      // Performance Mode - AGGRESSIVE disable all visual effects
      if (config.performanceMode) {
        css += `
                /* PERFORMANCE MODE - Disable ALL animations and transitions */
                /* Exclude Theme Editor panel to keep it centered */
                *:not(#theme-editor-panel):not(#theme-editor-panel *):not(#te-toast-container):not(#te-toast-container *):not(#te-confirm-overlay):not(#te-confirm-overlay *),
                *:not(#theme-editor-panel):not(#theme-editor-panel *)::before,
                *:not(#theme-editor-panel):not(#theme-editor-panel *)::after {
                    transition: none !important;
                    animation: none !important;
                    animation-delay: 0s !important;
                    animation-duration: 0s !important;
                    transition-delay: 0s !important;
                    transition-duration: 0s !important;
                    scroll-behavior: auto !important;
                    will-change: auto !important;
                    filter: none !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                
                /* Disable transforms except for Theme Editor, Progress Bar, Search, SVGs, and TopBar */
                body *:not(#theme-editor-panel):not(#te-confirm-overlay):not(#te-confirm-overlay *):not(.x-progressBar-fillColor):not(.x-progressBar-progressBarBg):not([class*="progressBar"]):not([class*="progress-bar"]):not([class*="ProgressBar"]):not(.playback-bar):not(.playback-bar *):not(svg):not(svg *):not([class*="search"]):not([class*="Search"]):not([role="searchbox"]):not([data-testid*="search"]):not(.main-topBar-container):not(.main-topBar-container *) {
                    transform: none !important;
                }
                
                /* Disable all hover effects except progress bar */
                *:not(.x-progressBar-fillColor):not([class*="progressBar"]):not([class*="progress-bar"]):hover {
                    transform: none !important;
                    box-shadow: none !important;
                    filter: none !important;
                    opacity: 1 !important;
                }
                
                /* Disable shadows globally */
                * {
                    box-shadow: none !important;
                    text-shadow: none !important;
                }
                
                /* Disable gradients - use solid colors */
                body, .Root, .Root__top-container, .Root__main-view,
                .main-view-container, .Root__nav-bar, aside, nav, footer,
                [class*="Card"], [class*="card"], .main-card-card {
                    background-image: none !important;
                    background: #121212 !important;
                }
                
                /* Simple sidebar */
                .Root__nav-bar, aside, nav {
                    background: #000000 !important;
                }
                
                /* Simple player bar */
                .main-nowPlayingBar-container, footer, .Root__now-playing-bar {
                    background: #181818 !important;
                }
                
                /* Disable blur on all elements */
                .main-topBar-container, .main-topBar-background,
                [class*="blur"], [class*="Blur"] {
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    background: rgba(18, 18, 18, 0.95) !important;
                }
                
                /* Disable glow effects */
                [class*="glow"], [class*="Glow"] {
                    box-shadow: none !important;
                    filter: none !important;
                }
                
                /* Disable overlay animations */
                .GenericModal, [class*="Modal"], [class*="modal"],
                [class*="overlay"], [class*="Overlay"] {
                    animation: none !important;
                    transition: none !important;
                }
                
                /* Disable loading animations */
                [class*="loading"], [class*="Loading"], [class*="spinner"], [class*="Spinner"] {
                    animation: none !important;
                }
                
                /* Disable progress bar animations */
                .x-progressBar-fillColor, [class*="progress"] {
                    transition: none !important;
                }
                
                /* Hide decorative elements */
                .main-entityHeader-overlay,
                .main-entityHeader-backgroundColor,
                [class*="gradient"], [class*="Gradient"] {
                    display: none !important;
                }
                
                /* Disable image effects */
                img {
                    filter: none !important;
                    transform: none !important;
                }
                `;
      }

      css += `
            .x-progressBar-progressBarBg, .x-progressBar-sliderArea, .x-progressBar-fillColor { height: ${pbHeight}px !important; border-radius: ${Math.ceil(pbHeight / 2)}px !important; }
            .main-yourLibraryX-listItemImage img, .main-yourLibraryX-listItemImage > div, .LBM25IAoFtd0wh7k3EGM, ._bmrtgr4_Tgsoiaz4c85, .bFtVZZnZgTWjjyzkPA5k, .VPnrctjNWVzCtyD7DZAG, .PgTMmU2Gn7AESFMYhw4i, .GTdNqPsL1mHfybwJSeVz, .x-entityImage-imageContainer, .x-entityImage-image { border-radius: 8px !important; overflow: hidden !important; }
            .Root__main-view, .main-view-container, .main-card-card, [class*="Card"], [class*="card"], aside, nav, footer, .Root__nav-bar { border-radius: 0 !important; }
            .Root__right-sidebar, .main-nowPlayingView-coverArtContainer, .main-nowPlayingView-content, .main-nowPlayingView-nowPlayingGrid, [data-testid="now-playing-widget"], .now-playing-bar, .Root__now-playing-bar { background: transparent !important; background-color: transparent !important; }
            .Root__top-bar, .main-topBar-container, .main-topBar-topbarContent, .main-topBar-background, [data-testid="topbar-content-wrapper"], .spotify__container--is-desktop .Root__top-bar { background: transparent !important; background-color: transparent !important; }
            .main-nowPlayingView-section, .main-nowPlayingView-sectionHeaderLink, .main-nowPlayingView-sectionTitle { background: transparent !important; }
            ._EzvsrEJ47TI8hxzRoKx, .t_dtt9KL1wnNRvRO_y5L, .t_dtt9KL1wnNRvRO_y5L > div { display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; text-align: center !important; width: 100% !important; }
            [data-testid="lyrics-line"], div[data-testid="lyrics-line"], .o69qODXrbOkf6Tv7fa51, div.o69qODXrbOkf6Tv7fa51 { text-align: center !important; width: 100% !important; display: flex !important; justify-content: center !important; align-items: center !important; transform: none !important; left: auto !important; right: auto !important; margin-left: auto !important; margin-right: auto !important; position: relative !important; inset: auto !important; }
            [dir="auto"][data-testid="lyrics-line"], [dir="rtl"][data-testid="lyrics-line"] { text-align: center !important; direction: ltr !important; justify-content: center !important; }
            .MmIREVIj8A2aFVvBZ2Ev, div.MmIREVIj8A2aFVvBZ2Ev, .o69qODXrbOkf6Tv7fa51 .MmIREVIj8A2aFVvBZ2Ev { text-align: center !important; width: auto !important; display: inline-block !important; margin: 0 auto !important; transform: none !important; direction: rtl !important; unicode-bidi: plaintext !important; }
            .adSF6zkjcpNDto9qhTdV, .adSF6zkjcpNDto9qhTdV p { text-align: center !important; width: 100% !important; display: block !important; }
            .Plu0zvuRv7kOQwsQ02cC, .PSyA4iign083ZV6vOqPj, ._gZrl2ExJwyxPy1pEUG2, .pfNmto1uY0N1izbydTIi { text-align: center !important; justify-content: center !important; transform: none !important; left: auto !important; right: auto !important; position: relative !important; inset: auto !important; }
            .lyrics-lyrics-contentWrapper { text-align: center !important; }
            
            /* FORCE TRANSPARENCY for Sponsored/Special Playlists */
            [data-transition="sponsoredPlaylistContent"],
            [data-transition="sponsoredPlaylistContent"] > div,
            [data-transition="sponsoredPlaylistContent"] > div > div, 
            .main-view-container__scroll-node-child {
                --background-base: transparent !important;
                --background-highlight: transparent !important;
                --background-press: transparent !important;
                --background-elevated-base: transparent !important;
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }

            /* NUCLEAR LYRICS BACKGROUND REMOVAL */
            [data-testid="lyrics-page"],
            [data-testid="fullscreen-lyrics-page"],
            .lyrics-lyrics-container,
            .lyrics-lyrics-contentWrapper,
            div[class*="lyrics-lyrics-container"],
            div[class*="Lyrics__Container"],
            div[style*="--lyrics-color-background"],
            div[style*="background-color"],
            .l2060qoyWU4J9ihSxHLE, 
            ._EzvsrEJ47TI8hxzRoKx, 
            .t_dtt9KL1wnNRvRO_y5L {
                --lyrics-color-background: transparent !important;
                --background-base: transparent !important;
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            /* Force all children to be transparent (except text is not background) */
            [data-testid="lyrics-page"] *,
            [data-testid="fullscreen-lyrics-page"] *,
            .lyrics-lyrics-container * {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
                box-shadow: none !important;
            }`;

      // Only add smooth animations when Performance Mode is OFF
      if (!config.performanceMode) {
        css += `
                /* ========== SMOOTH ANIMATIONS (Disabled in Performance Mode) ========== */
                *:not(h1):not(.main-entityHeader-title):not([data-testid="entityTitle"]):not(.vamOGPv1eDxaQS4qflcg), *::before, *::after { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important; }
                [class*="Card"]:hover, [class*="card"]:hover, .main-card-card:hover { transform: translateY(-8px) scale(1.03) !important; box-shadow: 0 20px 40px rgba(0,0,0,0.5), 0 0 20px rgba(30,215,96,0.15) !important; }
                [class*="Card"], [class*="card"], .main-card-card { transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.4s ease !important; }
                button:not(.vamOGPv1eDxaQS4qflcg):hover, [role="button"]:not(.vamOGPv1eDxaQS4qflcg):hover { transform: scale(1.08) !important; filter: brightness(1.2) !important; }
                button:not(.vamOGPv1eDxaQS4qflcg):active, [role="button"]:not(.vamOGPv1eDxaQS4qflcg):active { transform: scale(0.95) !important; }
                button:not(.vamOGPv1eDxaQS4qflcg), [role="button"]:not(.vamOGPv1eDxaQS4qflcg) { transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.2s ease !important; }
                [role="row"]:hover { background-color: rgba(255,255,255,0.12) !important; transform: translateX(5px) !important; }
                [role="row"] { transition: background-color 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) !important; }
                img:hover { transform: scale(1.02) !important; }
                img { transition: transform 0.3s ease !important; }
                .main-nowPlayingView-coverArt:hover { transform: scale(1.03) rotate(1deg) !important; }
                .main-yourLibraryX-listItem:hover, [class*="listItem"]:hover { transform: translateX(8px) scale(1.02) !important; background: rgba(255,255,255,0.08) !important; }
                .main-yourLibraryX-listItem, [class*="listItem"] { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.3s ease !important; }
                a:hover, [class*="navBar"]:hover { filter: brightness(1.3) !important; }
                a { transition: filter 0.2s ease, color 0.2s ease !important; }
                [data-testid="playlist-image"]:hover img { transform: scale(1.02) rotate(1deg) !important; }
                [data-testid="playlist-image"] img { transition: transform 0.3s ease !important; }
                [data-testid="play-button"]:hover, [aria-label="Play"]:hover { transform: scale(1.15) !important; box-shadow: 0 0 25px rgba(30,215,96,0.6) !important; }
                [data-encore-id="chip"]:hover { transform: scale(1.04) translateY(-1px) !important; box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important; }
                [data-encore-id="chip"] { transition: all 0.2s ease !important; }
                input[class*="search"], [role="searchbox"] { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important; }
                input[class*="search"]:focus, [role="searchbox"]:focus { transform: scale(1.02) !important; box-shadow: 0 0 15px rgba(255,255,255,0.1) !important; }
                .main-contextMenu-menuItem, [role="tooltip"], .main-contextMenu-menu { animation: te-slideUp 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards !important; transform-origin: top center; }
                @keyframes te-slideUp { from { opacity: 0; transform: translateY(10px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
                .x-progressBar-fillColor:hover, .x-progressBar-sliderArea:hover { filter: brightness(1.3) drop-shadow(0 0 8px rgba(30,215,96,0.8)) !important; }
                [data-testid="control-button-shuffle"]:hover, [data-testid="control-button-repeat"]:hover, [aria-label="Previous"]:hover, [aria-label="Next"]:hover { transform: scale(1.2) rotate(10deg) !important; }
                [data-testid="volume-slider"]:hover { transform: scaleX(1.1) !important; }
                .os-scrollbar-handle { width: 0.25rem !important; border-radius: 10rem !important; transition: width 300ms ease-in-out, background-color 300ms ease !important; }
                .os-scrollbar-handle:hover { width: 0.5rem !important; background-color: rgba(255,255,255,0.4) !important; }
                .main-trackInfo-name:hover, .main-trackInfo-artists:hover { text-shadow: 0 0 10px rgba(255,255,255,0.3) !important; }
                @property --progress-bar-transform { inherits: true; initial-value: 0%; syntax: '<percentage>'; }
                .progress-bar { transition: --progress-bar-transform 1s linear !important; }
                .progress-bar--isDragging { transition-duration: 150ms !important; }
                button[aria-label='Listen Together'] svg * { fill: currentColor !important; transform: scale(0.95) !important; transform-origin: center !important; }
                `;
      }

      // Static styles (always applied)
      css += `
            .main-entityHeader-title, .main-entityHeader-title *, [data-testid="entityTitle"], [data-testid="entityTitle"] *, h1.encore-text-headline-large, h1.encore-text-headline-large *, .vamOGPv1eDxaQS4qflcg, .vamOGPv1eDxaQS4qflcg * { transform: none !important; transition: none !important; animation: none !important; margin: 0 !important; filter: none !important; }
            .c55UACltdzzDDQVfoF18, .main-entityHeader-textContainer { transform: none !important; transition: none !important; }
            .main-actionBar-exploreButton { display: none !important; }
            #_R_G *:not([fill="none"]) { fill: var(--spice-button) !important; }
            #_R_G *:not([stroke="none"]) { stroke: var(--spice-button); }
            .main-addButton-button[aria-checked="false"] { color: rgba(var(--spice-rgb-selected-row), 0.7); }
            .control-button-heart[aria-checked="true"], .main-addButton-button, .main-addButton-active:focus, .main-addButton-active:hover { color: var(--spice-button); }
            .main-yourEpisodesButton-yourEpisodesIcon { background: var(--spice-text); color: var(--spice-sidebar); }
            #spicetify-sticky-list>li:nth-child(1n+1)>a>div.icon.collection-icon>svg:not(.lucide-crown) { stroke: currentcolor; stroke-width: 11px; }
            .collection-icon { color: unset; }`;

      // Hiding elements logic
      if (config.hidePlaylistCover) css += `.main-entityHeader-imageContainer.main-entityHeader-imageContainerNew { display: none !important; }`;
      if (config.hideMadeForYou) css += `section[aria-label^='Made For'] { display: none !important; }`;
      if (config.hideLikedSongsCard) css += `.collection-collectionEntityHeroCard-likedSongs { display: none !important; }`;
      if (config.hideRecentlyPlayed) css += `.main-shelf-shelf:has([href='/genre/recently-played']) { display: none !important; }`;
      if (config.hideFullscreenCard) css += `.npv-header.npv-header { display: none !important; }`;
      if (config.hideProfileUsername) css += `.main-userWidget-displayName { display: none !important; }`;
      if (config.hideRecentSearches) css += `.main-shelf-shelf:has(.x-searchHistoryEntries-searchHistoryEntry) { display: none !important; }`;
      if (config.hideDownloadButton) css += `.x-downloadButton-DownloadButton { display: none !important; }`;
      if (config.hideWhatsNew) css += `[aria-label="What's New"] { display: none !important; }`;
      if (config.hideFriendActivity) css += `[aria-label='Friend Activity'] { display: none !important; }`;
      if (config.hideAudiobooks) css += `button[aria-label='Audiobooks'] { display: none !important; }`;
      if (config.hidePodcasts) css += `button[aria-label='Podcasts'] { display: none !important; }`;
      if (config.hideMiniPlayer) css += `button:has(path[d='M16 2.45c0-.8-.65-1.45-1.45-1.45H1.45C.65 1 0 1.65 0 2.45v11.1C0 14.35.65 15 1.45 15h5.557v-1.5H1.5v-11h13V7H16V2.45z']), button:has(path[d='M16 2.45c0-.8-.65-1.45-1.45-1.45H1.45C.65 1 0 1.65 0 2.45v11.1C0 14.35.65 15 1.45 15h5.557v-1.5H1.5v-11h13V7H16z']) { display: none !important; }`;
      if (config.hideFullscreenButton) css += `[data-testid="fullscreen-mode-button"] { display: none !important; }`;
      if (config.hidePlayCount) css += `.main-trackList-playsHeader, .main-trackList-rowPlayCount { display: none !important; }`;
      if (config.hideConnectBar) css += `.main-connectBar-connectBar { display: none !important; }`;
      if (config.declutterNowPlaying) css += `.main-nowPlayingView-section { display: none !important; } .main-nowPlayingView-aboutArtistV2 { display: none !important; } .nw2W4ZMdICuBo08Tzxg9 { justify-content: center; height: 100%; width: 100%; } .Loading { display: none !important; } .LoadingLyricsCard { display: none !important; } .f6_Fu_ei4TIJWR0wzvTk { display: none !important; }`;
      if (config.hideArtistCredits) css += `.nw2W4ZMdICuBo08Tzxg9 { justify-content: center; height: 100%; width: 100%; } .main-nowPlayingView-section:not(.main-nowPlayingView-queue) { display: none !important; }`;
      if (config.disableHomeRecommendations) css += `[data-testid='home-page'] .contentSpacing > *:not(.view-homeShortcutsGrid-shortcuts, [data-testid='component-shelf']:has([href="/genre/recently-played"], [href="/section/0JQ5DAnM3wGh0gz1MXnu3z"])) { display: none !important; }`;
      if (config.smallerSidebarCover) css += `:root { --right-sidebar-cover-art-size: 85px; } .main-nowPlayingView-coverArt { width: var(--right-sidebar-cover-art-size); } .main-nowPlayingView-coverArtContainer { min-height: unset !important; width: var(--right-sidebar-cover-art-size) !important; } .main-nowPlayingView-nowPlayingGrid { flex-direction: row !important; align-items: center; } .main-nowPlayingView-contextItemInfo { flex: 1; } .main-nowPlayingView-contextItemInfo .main-trackInfo-name { font-size: 1.25rem; } .main-nowPlayingView-contextItemInfo .main-trackInfo-artists { font-size: 0.85rem; } .main-nowPlayingView-contextItemInfo:before { display: none !important; }`;
      if (config.hideFilterChips) css += `.rjsuxO8gqIyaiYTHNpOQ, .xUGeaiU1sWmepe7irxSb, [data-testid="carousel-scroller"], .JDUqvfRssLaT4MgywPx0, [role="listbox"][aria-label="Filter options"], .LegacyChip__LegacyChipComponent-sc-tzfq94-0, [data-encore-id="chip"] { display: none !important; }`;

      // Rounded UI Style
      if (config.roundedUI) css += `
                :root { --border-radius: 8px; --button-radius: 8px; }
                .Root__nav-bar { background: transparent !important; }
                .Root__nav-bar .main-yourLibraryX-entryPoints, .Root__nav-bar #Desktop_LeftSidebar_Id { 
                    background: var(--spice-sidebar) !important; 
                    border-radius: var(--border-radius) !important; 
                    margin: 8px !important;
                    padding: 8px !important;
                }
                .Root__nav-bar .main-rootlist-wrapper { 
                    background: var(--spice-sidebar) !important; 
                    border-radius: var(--border-radius) !important; 
                    margin: 0 8px 8px 8px !important;
                }
                .Root__nav-bar .main-yourLibraryX-listItemImage img, 
                .Root__nav-bar .main-yourLibraryX-listItemImage > div, 
                .Root__nav-bar .LBM25IAoFtd0wh7k3EGM { 
                    border-radius: var(--border-radius) !important; 
                    overflow: hidden !important; 
                }
                .Root__nav-bar .main-yourLibraryX-isScrolled { box-shadow: none !important; }
                .Root__nav-bar .os-scrollbar { display: none; }
                .Root__main-view { background: transparent !important; }
                .Root__main-view .main-view-container { 
                    background: var(--spice-main) !important; 
                    border-radius: var(--border-radius) !important; 
                    margin: 8px 8px 8px 0 !important;
                }
                .main-nowPlayingBar-container { 
                    background: var(--spice-player) !important; 
                    border-radius: var(--border-radius) var(--border-radius) 0 0 !important; 
                    margin: 0 8px !important;
                }
                .Root__right-sidebar aside { 
                    background: var(--spice-sidebar) !important; 
                    border-radius: var(--border-radius) !important; 
                    margin: 8px 8px 8px 0 !important;
                }
                .main-card-card { 
                    background: var(--spice-card, var(--spice-sidebar)) !important; 
                    border-radius: var(--border-radius) !important; 
                    padding: 0 !important; 
                    overflow: hidden !important; 
                }
                .main-card-card:hover { background: var(--spice-highlight, var(--spice-card)) !important; }
                .main-card-card .main-card-imageContainer { margin-bottom: -4px; }
                .main-card-card .main-card-imageContainer img { border-radius: 0 !important; }
                .main-card-card .main-card-cardMetadata { padding: 16px; }
                button, button span, input, select, img, .x-entityImage-xsmall { border-radius: var(--border-radius) !important; }
                .main-topBar-container, .main-topBar-topbarContent, .main-topBar-background { background: transparent !important; }
            `;

      // Comfy Header Style (Always Applied)
      css += `
                .main-entityHeader-container {
                    padding: 32px !important;
                    justify-content: flex-end !important;
                }
                .main-entityHeader-imageContainer {
                    width: 232px !important;
                    height: 232px !important;
                    align-self: flex-end !important;
                    box-shadow: 0 4px 60px rgba(0,0,0,0.5) !important;
                }
                .main-entityHeader-title h1 {
                    font-size: 6rem !important;
                    line-height: normal !important;
                    font-weight: 900 !important;
                    letter-spacing: -0.04em !important;
                }
                .main-entityHeader-metaData {
                    color: rgba(255,255,255,0.7) !important;
                }
            `;


      // Player Bar Styles
      if (config.playerBarStyle === 'rounded') {
        css += `
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        background: var(--spice-player) !important;
                        border-radius: 8px !important;
                        margin: 0 8px 8px 8px !important;
                        padding: 8px !important;
                    }
                    .Root__now-playing-bar .main-nowPlayingBar-nowPlayingBar {
                        border-radius: 8px !important;
                    }
                    /* Progress bar fix - ensure all layers have same height */
                    .playback-progressbar-container,
                    .playback-progressbar,
                    .x-progressBar-progressBarBg,
                    .x-progressBar-sliderArea,
                    .progress-bar,
                    .progress-bar__bg { 
                        height: 6px !important; 
                        border-radius: 50px !important;
                    }
                    /* Fill element - don't override transform (it uses scaleX for progress) */
                    .x-progressBar-fillColor,
                    .progress-bar__fg { 
                        height: 6px !important; 
                        border-radius: 50px !important;
                    }
                `;
      } else if (config.playerBarStyle === 'floating') {
        css += `
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        background: var(--spice-player) !important;
                        border-radius: 16px !important;
                        margin: 8px 16px !important;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
                    }
                `;
      } else if (config.playerBarStyle === 'minimal') {
        css += `
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        background: transparent !important;
                        border-top: 1px solid rgba(255,255,255,0.1) !important;
                    }
                    .main-nowPlayingBar-left, .main-nowPlayingBar-right { opacity: 0.7; }
                    .main-nowPlayingBar-left:hover, .main-nowPlayingBar-right:hover { opacity: 1; }
                `;
      } else if (config.playerBarStyle === 'downside-bar') {
        // Full Custom Downside Playbar - Progress bar at bottom of screen
        css += `
                    :root { 
                        --cover-art-width: 84px; 
                        --cover-art-height: 84px; 
                        --cover-art-radius: 8px; 
                        --cover-art-left: 0px; 
                        --cover-art-bottom: 20px; 
                    }
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        position: relative !important;
                        border-top: none !important;
                        flex-direction: column-reverse !important;
                        background: var(--spice-player) !important;
                    }
                    .Root__now-playing-bar .main-nowPlayingBar-nowPlayingBar {
                        margin-bottom: 12px !important;
                    }
                    .Root__now-playing-bar .player-controls__buttons--new-icons {
                        margin-bottom: 0 !important;
                    }
                    .Root__now-playing-bar .playback-bar {
                        position: fixed !important;
                        display: grid !important;
                        grid-template-columns: auto auto !important;
                        grid-template-areas: "time-left time-right" "bar bar" !important;
                        bottom: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        gap: 0 !important;
                        width: 100% !important;
                        z-index: 9999 !important;
                    }
                    .Root__now-playing-bar .playback-bar > div:not(.playback-progressbar-container) {
                        text-align: center !important;
                    }
                    .Root__now-playing-bar .playback-bar > div:first-of-type:not(.playback-progressbar-container) {
                        grid-area: time-left !important;
                    }
                    .Root__now-playing-bar .playback-bar > div:last-of-type:not(.playback-progressbar-container) {
                        grid-area: time-right !important;
                    }
                    .Root__now-playing-bar .playback-progressbar-container {
                        display: contents !important;
                    }
                    .Root__now-playing-bar .playback-progressbar {
                        grid-column: 1/3 !important;
                        grid-area: bar !important;
                        height: 11px !important;
                    }
                    .Root__now-playing-bar .playback-progressbar .progress-bar {
                        --progress-bar-height: 12px !important;
                        --progress-bar-radius: 0 !important;
                    }
                    .Root__now-playing-bar .x-progressBar-fillColor {
                        width: 100% !important;
                        background-color: transparent !important;
                        background-image: linear-gradient(90deg, var(--spice-button, #1db954) 100%, transparent 100%) !important;
                    }
                    .Root__now-playing-bar .progress-bar__slider {
                        display: none !important;
                    }
                    .Root__now-playing-bar .main-nowPlayingBar-volumeBar .progress-bar {
                        --bg-color: rgba(255,255,255, 0.3) !important;
                    }
                    .Root__now-playing-bar .main-nowPlayingBar-extraControls button:not(.main-genericButton-buttonActive) {
                        color: rgba(255,255,255, 0.7) !important;
                    }
                    .Root__now-playing-bar .main-nowPlayingBar-extraControls button:not(.main-genericButton-buttonActive):hover {
                        color: var(--spice-text) !important;
                    }
                    .Root__now-playing-bar .main-devicePicker-indicator {
                        display: none !important;
                    }
                    .main-nowPlayingWidget-nowPlaying {
                        height: 0 !important;
                        z-index: 1 !important;
                        left: var(--cover-art-left) !important;
                    }
                    .main-coverSlotCollapsed-container {
                        bottom: var(--cover-art-bottom) !important;
                        border-radius: var(--cover-art-radius) !important;
                    }
                    .main-coverSlotCollapsed-container > div button {
                        border-radius: var(--cover-art-radius) !important;
                        background: none !important;
                    }
                    .main-coverSlotCollapsed-container .cover-art,
                    .main-coverSlotCollapsed-container .VideoPlayer__container video {
                        width: var(--cover-art-width) !important;
                        height: var(--cover-art-height) !important;
                        border-radius: var(--cover-art-radius) !important;
                        overflow: hidden !important;
                        object-fit: cover !important;
                        max-height: none !important;
                        max-width: none !important;
                    }
                `;
      }

      if (config.playerBarBlur) {
        css += `
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        background: rgba(var(--spice-rgb-player, 0,0,0), 0.7) !important;
                        backdrop-filter: blur(20px) !important;
                        -webkit-backdrop-filter: blur(20px) !important;
                    }
                `;
      }

      if (config.playerBarGradient) {
        css += `
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        background: linear-gradient(90deg, 
                            var(--spice-player) 0%, 
                            var(--spice-sidebar) 50%, 
                            var(--spice-player) 100%) !important;
                    }
                `;
      }

      if (config.playerBarTransparent) {
        css += `
                    .Root__now-playing-bar .main-nowPlayingBar-container {
                        background: transparent !important;
                    }
                `;
      }

      // Render GIFs
      this.renderGifs();

      // Fonts & Presets
      const fontObj = Constants.FONTS.find(f => f.name === config.fontFamily);
      if (fontObj && fontObj.value) {
        this.loadFont(fontObj.url);
        css += `html, body, *, button, input, textarea, select, [class*="text"], [class*="Text"], [class*="title"], [class*="Title"], .encore-text-body-medium, .encore-text-body-small, .encore-text-title-medium, .main-type-ballad, .main-type-canon, .main-type-mesto { font-family: ${fontObj.value} !important; }`;
      }
      css += `html { font-size: ${config.fontSize}px !important; } body { font-size: ${config.fontSize}px !important; } .encore-text-body-medium { font-size: ${config.fontSize}px !important; } .encore-text-body-small { font-size: ${Math.max(10, config.fontSize - 2)}px !important; }`;

      if (config.preset !== 'Default' && Constants.PRESETS[config.preset] && Constants.PRESETS[config.preset] !== 'DYNAMIC') {
        const p = Constants.PRESETS[config.preset];
        css += `:root {`;
        for (let key in p) { css += `${key}: ${p[key]} !important;`; }
        css += `}`;
        css += `body, .Root, .Root__top-container { background-color: var(--spice-main) !important; } .Root__nav-bar, aside, nav { background-color: var(--spice-sidebar) !important; } .main-nowPlayingBar-container, footer { background-color: var(--spice-player) !important; }`;
      }

      // Modes
      if (config.mode === 'Gaming') {
        css += `@keyframes rgbCycle { 0% { outline-color: #ff0000; } 5% { outline-color: #ff4000; } 10% { outline-color: #ff8000; } 15% { outline-color: #ffbf00; } 20% { outline-color: #ffff00; } 25% { outline-color: #bfff00; } 30% { outline-color: #80ff00; } 35% { outline-color: #40ff00; } 40% { outline-color: #00ff00; } 45% { outline-color: #00ff40; } 50% { outline-color: #00ff80; } 55% { outline-color: #00ffbf; } 60% { outline-color: #00ffff; } 65% { outline-color: #00bfff; } 70% { outline-color: #0080ff; } 75% { outline-color: #0040ff; } 80% { outline-color: #0000ff; } 85% { outline-color: #4000ff; } 90% { outline-color: #8000ff; } 95% { outline-color: #bf00ff; } 100% { outline-color: #ff00ff; } }
                @keyframes rgbTextGlow { 0% { text-shadow: 0 0 8px #ff0000; color: #ff0000; } 25% { text-shadow: 0 0 8px #00ff00; color: #00ff00; } 50% { text-shadow: 0 0 8px #0000ff; color: #0000ff; } 75% { text-shadow: 0 0 8px #ff00ff; color: #ff00ff; } 100% { text-shadow: 0 0 8px #ff0000; color: #ff0000; } }
                .Root__main-view, .main-rootlist-rootlist, .main-yourLibraryX-entryPoints, .main-nowPlayingBar-container, .main-view-container, aside, nav, footer { outline: 3px solid #ff0000; outline-offset: -3px; animation: rgbCycle var(--te-anim-speed) linear infinite alternate !important; }
                [data-testid="context-item-info-title"], .main-trackInfo-name { animation: rgbTextGlow calc(var(--te-anim-speed) / 2) linear infinite alternate !important; }
                [class*="Card"]:hover, [class*="card"]:hover { outline: 3px solid #00ff00; outline-offset: -3px; animation: rgbCycle calc(var(--te-anim-speed) / 2) linear infinite alternate !important; }`;
      }

      this.injectCSS(css);
    }
  };

  // ==========================================================================================
  // 🎨 MODULE: UI & PANEL (HTML from Code 1, Logic from Code 2)
  // ==========================================================================================

  /**
   * UI Manager for the theme editor panel and controls
   * @namespace UI
   */
  const UI = {
    panel: null,
    overlay: null,
    previousActiveElement: null,
    previewStyleElement: null,
    isDragging: false,

    /**
     * Initializes the UI components
     * @returns {void}
     */
    init() {
      // Safe API calls with optional chaining
      if (Spicetify?.Menu?.Item) {
        try {
          new Spicetify.Menu.Item(NAME, false, () => this.toggle()).register?.();
        } catch (e) {
          console.warn('[Theme Editor] Failed to register menu item:', e.message);
        }
      }
      if (Spicetify?.Topbar?.Button) {
        try {
          const icon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1c.83 0 1.5.67 1.5 1.5v11c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11C1 1.67 1.67 1 2.5 1h11zM8 11a3 3 0 100-6 3 3 0 000 6z"/></svg>`;
          new Spicetify.Topbar.Button(NAME, icon, () => this.toggle());
        } catch (e) {
          console.warn('[Theme Editor] Failed to create topbar button:', e.message);
        }
      }
      this.createFab();

    },

    /**
     * Creates the floating action button (FAB)
     * @returns {void}
     */
    createFab() {
      const fab = document.createElement('button');
      fab.textContent = '🎨';
      fab.id = 'te-fab-button';
      fab.setAttribute('aria-label', 'Open Theme Editor');
      fab.setAttribute('title', 'Open Theme Editor');
      fab.style.cssText = `position: fixed; bottom: 100px; right: 30px; width: 55px; height: 55px; border-radius: 50%; background: linear-gradient(135deg, #e94560, #0f3460); color: white; border: none; font-size: 26px; cursor: pointer; z-index: 999999; box-shadow: 0 5px 20px rgba(233,69,96,0.5); transition: transform 0.2s, box-shadow 0.2s;`;
      fab.onmouseover = () => { fab.style.transform = 'scale(1.15)'; fab.style.boxShadow = '0 8px 30px rgba(233,69,96,0.7)'; };
      fab.onmouseout = () => { fab.style.transform = 'scale(1)'; fab.style.boxShadow = '0 5px 20px rgba(233,69,96,0.5)'; };
      fab.onclick = () => this.toggle();
      document.body.appendChild(fab);
    },

    createPanel() {
      if (this.panel) return;
      const config = Config.data;
      this.panel = document.createElement('div');
      this.panel.id = 'theme-editor-panel';
      this.panel.tabIndex = -1; // For focus management

      // Enhanced panel HTML with responsive styles, undo/redo, save preset, color harmony
      this.panel.innerHTML = `<style>
                #theme-editor-panel { 
                    position: fixed; 
                    top: 50%; left: 50%; 
                    width: 480px; max-height: 80vh; overflow-y: auto; 
                    background: linear-gradient(145deg, #1a1a2e, #16213e); 
                    border: 2px solid #0f3460; border-radius: 16px; padding: 24px; 
                    z-index: 999999; box-shadow: 0 25px 80px rgba(0,0,0,0.8), 0 0 30px rgba(15,52,96,0.5); 
                    color: #e0e0e0; font-family: 'Segoe UI', sans-serif;
                    /* Use margin for centering instead of transform */
                    margin-left: -240px;
                    margin-top: -40vh;
                }
                #theme-editor-panel h2 { 
                    text-align: center; margin-bottom: 20px; color: #e94560; font-size: 24px; 
                    cursor: move; user-select: none; 
                }
                #theme-editor-panel .control-group { margin-bottom: 18px; }
                #theme-editor-panel label { display: block; margin-bottom: 8px; font-weight: 600; color: #a0a0a0; }
                #theme-editor-panel select, #theme-editor-panel input[type="range"] { 
                    width: 100%; padding: 10px; background: #0f3460; color: #e0e0e0; 
                    border: 1px solid #1a1a2e; border-radius: 8px; outline: none; 
                }
                #theme-editor-panel input[type="range"] { -webkit-appearance: none; height: 8px; padding: 0; }
                #theme-editor-panel input[type="range"]::-webkit-slider-thumb { 
                    -webkit-appearance: none; width: 18px; height: 18px; 
                    background: #e94560; border-radius: 50%; cursor: pointer; 
                }
                #theme-editor-panel .close-btn { 
                    width: 100%; padding: 12px; background: linear-gradient(90deg, #e94560, #0f3460); 
                    color: white; border: none; border-radius: 8px; cursor: pointer; 
                    font-weight: bold; font-size: 16px; margin-top: 10px; transition: transform 0.2s, box-shadow 0.2s; 
                }
                #theme-editor-panel .close-btn:hover { transform: scale(1.02); box-shadow: 0 5px 20px rgba(233,69,96,0.4); }
                #theme-editor-panel .te-btn { 
                    padding: 8px 12px; background: #0f3460; color: #e0e0e0; 
                    border: 1px solid #1a1a2e; border-radius: 8px; cursor: pointer; 
                    font-size: 12px; transition: all 0.2s; 
                }
                #theme-editor-panel .te-btn:hover { background: #1a3a6a; transform: scale(1.02); }
                #theme-editor-panel .te-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                #theme-editor-panel .te-btn-danger { background: #8b0000; }
                #theme-editor-panel .te-btn-danger:hover { background: #a00000; }
                #theme-editor-panel .te-btn-success { background: #1db954; }
                #theme-editor-panel .te-btn-success:hover { background: #1ed760; }
                #te-color-harmony { 
                    display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; 
                }
                #te-color-harmony .color-swatch { 
                    width: 28px; height: 28px; border-radius: 6px; cursor: pointer; 
                    border: 2px solid rgba(255,255,255,0.2); transition: transform 0.2s, border-color 0.2s; 
                }
                #te-color-harmony .color-swatch:hover { transform: scale(1.15); border-color: #e94560; }
                /* Responsive styles */
                @media (max-width: 520px) {
                    #theme-editor-panel { width: 95vw !important; max-height: 90vh; padding: 16px; }
                    #theme-editor-panel h2 { font-size: 20px; }
                    #theme-editor-panel h3 { font-size: 14px !important; }
                    #theme-editor-panel .control-group { margin-bottom: 12px; }
                }
                /* Focus styles for accessibility */
                #theme-editor-panel *:focus { outline: 2px solid #e94560; outline-offset: 2px; }
            </style>
            <h2 id="te-panel-header">🎨 Theme Editor</h2>
            <div class="control-group"><label>Mode</label><select id="te-mode"><option value="Normal">Normal</option><option value="Gaming">Gaming (RGB)</option></select></div>
            <div class="control-group"><label>Color Preset</label><select id="te-preset"></select></div>
            <h3 style="color:#e94560;margin:15px 0 10px;">🎵 Player Bar Layout</h3>
            <div class="control-group"><label>Style</label><select id="te-playerBarStyle">
                <option value="default" ${config.playerBarStyle === 'default' ? 'selected' : ''}>Default</option>
                <option value="rounded" ${config.playerBarStyle === 'rounded' ? 'selected' : ''}>Rounded</option>
                <option value="downside-bar" ${config.playerBarStyle === 'downside-bar' ? 'selected' : ''}>⭐ Downside Bar (Full)</option>
                <option value="floating" ${config.playerBarStyle === 'floating' ? 'selected' : ''}>Floating</option>
                <option value="minimal" ${config.playerBarStyle === 'minimal' ? 'selected' : ''}>Minimal</option>
            </select></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-playerBarBlur" ${config.playerBarBlur ? 'checked' : ''} style="width:16px;height:16px;">Blur Effect</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-playerBarGradient" ${config.playerBarGradient ? 'checked' : ''} style="width:16px;height:16px;">Gradient</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-playerBarTransparent" ${config.playerBarTransparent ? 'checked' : ''} style="width:16px;height:16px;">Transparent</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-roundedUI" ${config.roundedUI ? 'checked' : ''} style="width:16px;height:16px;">Rounded UI</label>
            </div>
            <h3 style="color:#e94560;margin:15px 0 10px;">⚡ Effects</h3>
            <div class="control-group" style="margin-bottom:12px;padding:12px;background:rgba(139,0,0,0.2);border-radius:8px;border:1px solid rgba(233,69,96,0.3);">
                <label style="display:flex;align-items:center;gap:10px;color:#ff6b6b;font-weight:bold;">
                    <input type="checkbox" id="te-performanceMode" ${config.performanceMode ? 'checked' : ''} style="width:20px;height:20px;">
                    🚀 Performance Mode <span style="font-size:12px;color:#ff9900;">لأصحاب الجيل 11</span>
                </label>
            </div>
            <div class="control-group"><label>Animation Speed: <span id="te-speed-val">${config.animationSpeed}s</span></label><input type="range" id="te-speed" min="0.5" max="15" step="0.5" value="${config.animationSpeed}" ${config.performanceMode ? 'disabled' : ''}></div>
            <div class="control-group"><label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="te-show-next" ${config.showNextSong ? 'checked' : ''} style="width:16px;height:16px;">Show Next Song</label></div>
            <div class="control-group"><label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="te-autoplay" ${config.autoPlayOnStart ? 'checked' : ''} style="width:16px;height:16px;">Auto Play on Start</label></div>
            <h3 style="color:#e94560;margin:15px 0 10px;">🔤 Typography</h3>
            <div class="control-group"><label>Font Family</label><select id="te-font"></select></div>
            <div class="control-group"><label>Font Size: <span id="te-fontsize-val">${config.fontSize}px</span> <small style="color:#666;">(10-30)</small></label><input type="range" id="te-fontsize" min="10" max="30" value="${config.fontSize}"></div>
            <h3 style="color:#e94560;margin:15px 0 10px;">👁️ Hide/Show Elements</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hidePlaylistCover" ${config.hidePlaylistCover ? 'checked' : ''} style="width:16px;height:16px;">Playlist Cover</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideMadeForYou" ${config.hideMadeForYou ? 'checked' : ''} style="width:16px;height:16px;">Made For You</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideLikedSongsCard" ${config.hideLikedSongsCard ? 'checked' : ''} style="width:16px;height:16px;">Liked Songs Card</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideRecentlyPlayed" ${config.hideRecentlyPlayed ? 'checked' : ''} style="width:16px;height:16px;">Recently Played</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideFullscreenCard" ${config.hideFullscreenCard ? 'checked' : ''} style="width:16px;height:16px;">Fullscreen Card</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideProfileUsername" ${config.hideProfileUsername ? 'checked' : ''} style="width:16px;height:16px;">Profile Username</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideRecentSearches" ${config.hideRecentSearches ? 'checked' : ''} style="width:16px;height:16px;">Recent Searches</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideDownloadButton" ${config.hideDownloadButton ? 'checked' : ''} style="width:16px;height:16px;">Download Button</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideWhatsNew" ${config.hideWhatsNew ? 'checked' : ''} style="width:16px;height:16px;">What's New</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideFriendActivity" ${config.hideFriendActivity ? 'checked' : ''} style="width:16px;height:16px;">Friend Activity</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideAudiobooks" ${config.hideAudiobooks ? 'checked' : ''} style="width:16px;height:16px;">Audiobooks</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hidePodcasts" ${config.hidePodcasts ? 'checked' : ''} style="width:16px;height:16px;">Podcasts</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideMiniPlayer" ${config.hideMiniPlayer ? 'checked' : ''} style="width:16px;height:16px;">Mini Player</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideFullscreenButton" ${config.hideFullscreenButton ? 'checked' : ''} style="width:16px;height:16px;">Fullscreen Btn</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hidePlayCount" ${config.hidePlayCount ? 'checked' : ''} style="width:16px;height:16px;">Play Count</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideConnectBar" ${config.hideConnectBar ? 'checked' : ''} style="width:16px;height:16px;">Connect Bar</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-declutterNowPlaying" ${config.declutterNowPlaying ? 'checked' : ''} style="width:16px;height:16px;">Declutter Now Playing</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideArtistCredits" ${config.hideArtistCredits ? 'checked' : ''} style="width:16px;height:16px;">Artist Credits</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-disableHomeRecommendations" ${config.disableHomeRecommendations ? 'checked' : ''} style="width:16px;height:16px;">Home Recommendations</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-smallerSidebarCover" ${config.smallerSidebarCover ? 'checked' : ''} style="width:16px;height:16px;">Smaller Sidebar Art</label>
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" id="te-hideFilterChips" ${config.hideFilterChips ? 'checked' : ''} style="width:16px;height:16px;">Filter Chips</label>
            </div>
            <h3 style="color:#e94560;margin:15px 0 10px;">🎭 Character GIFs</h3>
            <div class="control-group"><label>Left Character</label><select id="te-char-left"></select></div>
            <div class="control-group"><label>Right Character</label><select id="te-char-right"></select></div>
            <div class="control-group"><label>GIF Scale: <span id="te-gif-scale-val">${config.gifScale || 1}x</span> <small style="color:#666;">(0.1-20)</small></label><input type="range" id="te-gif-scale" min="0.1" max="20" step="0.1" value="${config.gifScale || 1}"></div>
            
            <div style="margin-top:15px;padding:12px;background:rgba(15,52,96,0.3);border-radius:8px;border:1px solid rgba(233,69,96,0.2);">
                <h4 style="color:#e94560;margin:0 0 10px;font-size:14px;display:flex;align-items:center;justify-content:space-between;">
                    <span>➕ Add Custom GIF</span>
                    <button id="te-gif-guide" style="background:#0f3460;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="How to add GIFs">?</button>
                </h4>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <input type="text" id="te-custom-gif-name" placeholder="Name (e.g., MyDance)" style="padding:8px;background:#0f3460;color:#e0e0e0;border:1px solid #1a1a2e;border-radius:6px;font-size:12px;">
                    <input type="text" id="te-custom-gif-url" placeholder="GIF URL (https://...)" style="padding:8px;background:#0f3460;color:#e0e0e0;border:1px solid #1a1a2e;border-radius:6px;font-size:12px;">
                    <button id="te-add-custom-gif" class="te-btn te-btn-success" style="font-size:12px;">Add GIF</button>
                </div>
            </div>
            
            <div id="te-custom-gifs-list" style="margin-top:10px;"></div>
            

            
            <input type="file" id="te-import-file" accept=".json" style="display:none;">
            <button class="close-btn" id="te-close" aria-label="Close Theme Editor">Close</button>`;

      // Add accessibility attributes
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-modal', 'true');
      this.panel.setAttribute('aria-labelledby', 'te-panel-header');

      document.body.appendChild(this.panel);
      this.bindEvents();
      this.makeDraggable();

      this.overlay = document.createElement('div');
      this.overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 999998; display: none;`;
      this.overlay.onclick = () => this.toggle();
      document.body.appendChild(this.overlay);
      this.panel.style.display = 'none';
    },

    /**
     * Makes the panel draggable by its header
     */
    makeDraggable() {
      const header = this.panel.querySelector('#te-panel-header');
      if (!header) return;

      let startX, startY, initialLeft, initialTop;

      const handleMouseDown = (e) => {
        if (e.target !== header) return;
        this.isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.panel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        this.panel.style.transition = 'none';
        e.preventDefault();
      };

      const handleMouseMove = (e) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        // Use direct positioning instead of transform
        this.panel.style.left = (initialLeft + dx) + 'px';
        this.panel.style.top = (initialTop + dy) + 'px';
        this.panel.style.marginLeft = '0';
        this.panel.style.marginTop = '0';
      };

      const handleMouseUp = () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.panel.style.transition = '';
        }
      };

      header.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      // Register for cleanup to prevent memory leaks
      CleanupManager.addListener(header, 'mousedown', handleMouseDown);
      CleanupManager.addListener(document, 'mousemove', handleMouseMove);
      CleanupManager.addListener(document, 'mouseup', handleMouseUp);
    },

    bindEvents() {
      const panel = this.panel;
      const presetSelect = panel.querySelector('#te-preset');
      Object.keys(Constants.PRESETS).forEach(p => { const opt = document.createElement('option'); opt.value = p; opt.innerText = p; if (p === Config.get('preset')) opt.selected = true; presetSelect.appendChild(opt); });
      const fontSelect = panel.querySelector('#te-font');
      Constants.FONTS.forEach(f => { const opt = document.createElement('option'); opt.value = f.name; opt.innerText = f.name; if (f.name === Config.get('fontFamily')) opt.selected = true; fontSelect.appendChild(opt); });

      panel.querySelector('#te-mode').value = Config.get('mode');
      panel.querySelector('#te-mode').onchange = (e) => { Config.set('mode', e.target.value); };
      panel.querySelector('#te-preset').onchange = (e) => {
        Config.set('preset', e.target.value);
        if (Config.get('preset') === '🎵 Song Color') Features.SongColor.apply(true); else Features.SongColor.apply();

        // Remove custom colors style if it exists (cleanup)
        const customStyle = document.getElementById('te-custom-colors-style');
        if (customStyle) customStyle.remove();
      };

      // Debounced slider handlers to prevent excessive saves
      const debouncedSpeedSave = debounce((value) => Config.set('animationSpeed', value), 150);
      const debouncedFontSizeSave = debounce((value) => Config.set('fontSize', value), 150);
      const debouncedGifScaleSave = debounce((value) => Config.set('gifScale', value), 150);

      panel.querySelector('#te-speed').oninput = (e) => {
        panel.querySelector('#te-speed-val').innerText = e.target.value + 's';
        debouncedSpeedSave(parseFloat(e.target.value));
      };


      panel.querySelector('#te-show-next').onchange = (e) => { Config.set('showNextSong', e.target.checked); Features.NextSong.update(); };
      panel.querySelector('#te-autoplay').onchange = (e) => { Config.set('autoPlayOnStart', e.target.checked); };

      // Performance Mode handler - refreshes panel to update disabled states
      panel.querySelector('#te-performanceMode').onchange = (e) => {
        Config.set('performanceMode', e.target.checked);
        Toast.show(e.target.checked ? 'Performance Mode enabled! 🚀' : 'Performance Mode disabled', e.target.checked ? 'success' : 'info');
        this.refreshPanel();
      };
      panel.querySelector('#te-font').onchange = (e) => { Config.set('fontFamily', e.target.value); };
      panel.querySelector('#te-fontsize').oninput = (e) => {
        panel.querySelector('#te-fontsize-val').innerText = e.target.value + 'px';
        debouncedFontSizeSave(parseInt(e.target.value));
      };

      const toggleMap = { 'te-hidePlaylistCover': 'hidePlaylistCover', 'te-hideMadeForYou': 'hideMadeForYou', 'te-hideLikedSongsCard': 'hideLikedSongsCard', 'te-hideRecentlyPlayed': 'hideRecentlyPlayed', 'te-hideFullscreenCard': 'hideFullscreenCard', 'te-hideProfileUsername': 'hideProfileUsername', 'te-hideRecentSearches': 'hideRecentSearches', 'te-hideDownloadButton': 'hideDownloadButton', 'te-hideWhatsNew': 'hideWhatsNew', 'te-hideFriendActivity': 'hideFriendActivity', 'te-hideAudiobooks': 'hideAudiobooks', 'te-hidePodcasts': 'hidePodcasts', 'te-hideMiniPlayer': 'hideMiniPlayer', 'te-hideFullscreenButton': 'hideFullscreenButton', 'te-hidePlayCount': 'hidePlayCount', 'te-hideConnectBar': 'hideConnectBar', 'te-declutterNowPlaying': 'declutterNowPlaying', 'te-hideArtistCredits': 'hideArtistCredits', 'te-disableHomeRecommendations': 'disableHomeRecommendations', 'te-smallerSidebarCover': 'smallerSidebarCover', 'te-hideFilterChips': 'hideFilterChips', 'te-roundedUI': 'roundedUI', 'te-playerBarBlur': 'playerBarBlur', 'te-playerBarGradient': 'playerBarGradient', 'te-playerBarTransparent': 'playerBarTransparent' };
      Object.entries(toggleMap).forEach(([id, key]) => { const el = panel.querySelector('#' + id); if (el) el.onchange = (e) => { Config.set(key, e.target.checked); }; });

      panel.querySelector('#te-playerBarStyle').onchange = (e) => { Config.set('playerBarStyle', e.target.value); };

      // ===== CHARACTER GIFS with Custom GIF Support =====
      // ===== CHARACTER GIFS with Custom GIF Support =====
      // Generic Population Helper
      const populateCharacterDropdowns = () => {
        const builtInGifs = [
          { value: 'none', label: 'None' },
          { value: 'sonic', label: 'Sonic 🦔' },
          { value: 'jumping', label: 'Jumping 💃' },
          { value: 'duck', label: 'Duck 🦆' },
          { value: 'oneko', label: 'Neko Cat 🐱' }
        ];
        const customGifs = Config.data.customGifs || {};

        ['te-char-left', 'te-char-right'].forEach(id => {
          const select = panel.querySelector('#' + id);
          if (!select) return;
          const currentVal = Config.get(id === 'te-char-left' ? 'characterLeft' : 'characterRight');
          select.innerHTML = '';

          // Built-in
          builtInGifs.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.value;
            opt.textContent = g.label;
            if (g.value === currentVal) opt.selected = true;
            select.appendChild(opt);
          });

          // Custom
          if (Object.keys(customGifs).length > 0) {
            const grp = document.createElement('optgroup');
            grp.label = '⭐ Custom GIFs';
            Object.keys(customGifs).forEach(key => {
              const opt = document.createElement('option');
              opt.value = key;
              opt.textContent = key;
              if (key === currentVal) opt.selected = true;
              grp.appendChild(opt);
            });
            select.appendChild(grp);
          }
        });
      };

      populateCharacterDropdowns();

      panel.querySelector('#te-char-left').onchange = (e) => { Config.set('characterLeft', e.target.value); };
      panel.querySelector('#te-char-right').onchange = (e) => { Config.set('characterRight', e.target.value); };

      panel.querySelector('#te-gif-scale').oninput = (e) => {
        panel.querySelector('#te-gif-scale-val').innerText = e.target.value + 'x';
        debouncedGifScaleSave(parseFloat(e.target.value));
      };

      // Helper to render custom GIFs list
      const renderCustomGifsList = () => {
        const container = panel.querySelector('#te-custom-gifs-list');
        if (!container) return;
        const customGifs = Config.data.customGifs || {};
        container.innerHTML = '';

        if (Object.keys(customGifs).length === 0) {
          container.innerHTML = '<p style="color:#666;font-size:11px;">No custom GIFs added.</p>';
          return;
        }

        Object.keys(customGifs).forEach(name => {
          const item = document.createElement('div');
          item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:rgba(255,255,255,0.05);border-radius:4px;margin-bottom:4px;';
          item.innerHTML = `
                  <span style="font-size:11px;color:#ccc;">${sanitizeText(name)}</span>
                  <div style="display:flex;gap:4px;">
                      <button class="te-btn" title="Copy URL" style="padding:2px 6px;font-size:10px;">📋</button>
                      <button class="te-btn te-btn-danger" title="Delete" style="padding:2px 6px;font-size:10px;">✕</button>
                  </div>
              `;

          // Copy URL handler
          item.querySelectorAll('button')[0].onclick = () => {
            const url = customGifs[name];
            navigator.clipboard.writeText(url);
            Toast.show('URL copied to clipboard!', 'success');
          };

          // Delete handler
          item.querySelectorAll('button')[1].onclick = () => {
            delete Config.data.customGifs[name];
            Config.save();
            renderCustomGifsList();
            populateCharacterDropdowns();
            Toast.show(`Deleted "${name}"`, 'info');
          };
          container.appendChild(item);
        });
      };

      // Initialize list and dropdowns
      renderCustomGifsList();

      // Add Custom GIF handler
      const addGifBtn = panel.querySelector('#te-add-custom-gif');
      if (addGifBtn) {
        addGifBtn.onclick = () => {
          const nameInput = panel.querySelector('#te-custom-gif-name');
          const urlInput = panel.querySelector('#te-custom-gif-url');
          const name = nameInput.value.trim();
          const url = urlInput.value.trim();

          if (!name || !url) {
            Toast.show('Please enter name and URL', 'warning');
            return;
          }

          if (!Config.data.customGifs) Config.data.customGifs = {};
          Config.data.customGifs[name] = url;
          Config.save();

          nameInput.value = '';
          urlInput.value = '';
          renderCustomGifsList();
          populateCharacterDropdowns();
          Toast.show(`Added "${name}" 🎉`, 'success');
        };
      }

      panel.querySelector('#te-close').onclick = () => this.toggle();





      // ===== NEW: Export/Import/Reset Handlers =====
      // Export settings as JSON file
      const exportBtn = panel.querySelector('#te-export');
      if (exportBtn) {
        exportBtn.onclick = () => {
          const dataStr = Config.export();
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'theme-editor-settings.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          Toast.show('Settings exported successfully! 📤', 'success');
        };
      }

      // Import settings from JSON file
      const importFileInput = panel.querySelector('#te-import-file');
      const importBtn = panel.querySelector('#te-import');
      if (importBtn && importFileInput) {
        importBtn.onclick = () => importFileInput.click();
        importFileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (event) => {
            const success = Config.import(event.target.result);
            if (success) {
              Toast.show('Settings imported successfully! 📥', 'success');
              this.refreshPanel();
            } else {
              Toast.show('Failed to import settings. Invalid file format.', 'error');
            }
          };
          reader.readAsText(file);
          e.target.value = ''; // Reset file input
        };
      }

      // Reset settings to defaults with confirmation dialog
      const resetBtn = panel.querySelector('#te-reset');
      if (resetBtn) {
        resetBtn.onclick = () => {
          this.showConfirmDialog(
            'Reset Settings',
            'Are you sure you want to reset all settings to defaults? This cannot be undone.',
            () => {
              Config.reset();
              Toast.show('Settings reset to defaults! 🔄', 'success');
              this.refreshPanel();
            }
          );
        };
      }



      // ===== NEW: Undo/Redo Handlers =====
      const updateUndoRedoButtons = () => {
        const status = HistoryManager.getStatus();
        const undoBtn = panel.querySelector('#te-undo');
        const redoBtn = panel.querySelector('#te-redo');
        if (undoBtn) undoBtn.disabled = !status.canUndo;
        if (redoBtn) redoBtn.disabled = !status.canRedo;
      };

      const undoBtn = panel.querySelector('#te-undo');
      if (undoBtn) {
        undoBtn.onclick = () => {
          Config.undo();
          this.refreshPanel();
        };
      }

      const redoBtn = panel.querySelector('#te-redo');
      if (redoBtn) {
        redoBtn.onclick = () => {
          Config.redo();
          this.refreshPanel();
        };
      }

      // Initial button state
      updateUndoRedoButtons();

      // ===== NEW: Theme Preview on Preset Hover =====
      const presetDropdown = panel.querySelector('#te-preset');
      presetDropdown.addEventListener('mouseover', (e) => {
        if (e.target.tagName === 'OPTION' && e.target.value) {
          this.previewTheme(e.target.value);
        }
      });
      presetDropdown.addEventListener('mouseleave', () => {
        this.cancelPreview();
      });

      // ===== ENHANCED: Keyboard Navigation with Tab Trap =====
      const handleKeydown = (e) => {
        if (!this.panel || this.panel.style.display === 'none') return;

        if (e.key === 'Escape') {
          this.toggle();
          return;
        }

        // Tab trap for accessibility
        if (e.key === 'Tab') {
          const focusable = this.panel.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }

        // Ctrl+Z for undo, Ctrl+Y for redo
        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          Config.undo();
          this.refreshPanel();
        }
        if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
          e.preventDefault();
          Config.redo();
          this.refreshPanel();
        }
      };
      document.addEventListener('keydown', handleKeydown);
      CleanupManager.addListener(document, 'keydown', handleKeydown);
    },

    /**
     * Previews a theme preset temporarily
     * @param {string} presetName - The preset name to preview
     */
    previewTheme(presetName) {
      const preset = Constants.PRESETS[presetName];
      if (!preset || typeof preset !== 'object') return;

      if (!this.previewStyleElement) {
        this.previewStyleElement = document.createElement('style');
        this.previewStyleElement.id = 'te-preview-style';
        document.head.appendChild(this.previewStyleElement);
      }

      let css = ':root {';
      for (let key in preset) {
        css += `${key}: ${preset[key]} !important;`;
      }
      css += '}';
      css += `body, .Root, .Root__top-container { background-color: var(--spice-main) !important; }`;
      css += `.Root__nav-bar, aside, nav { background-color: var(--spice-sidebar) !important; }`;
      css += `.main-nowPlayingBar-container, footer { background-color: var(--spice-player) !important; }`;

      this.previewStyleElement.innerHTML = css;
    },

    /**
     * Cancels theme preview and restores current theme
     */
    cancelPreview() {
      if (this.previewStyleElement) {
        this.previewStyleElement.innerHTML = '';
      }
    },

    /**
     * Refreshes the preset dropdown including custom presets
     */
    refreshPresetDropdown() {
      const presetSelect = this.panel?.querySelector('#te-preset');
      if (!presetSelect) return;

      presetSelect.innerHTML = '';
      // Add built-in presets
      Object.keys(Constants.PRESETS).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.innerText = p;
        if (p === Config.get('preset')) opt.selected = true;
        presetSelect.appendChild(opt);
      });
      // Add custom presets
      const customPresets = Config.data.customPresets || {};
      if (Object.keys(customPresets).length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = '📁 Custom Presets';
        Object.keys(customPresets).forEach(name => {
          const opt = document.createElement('option');
          opt.value = `custom:${name}`;
          opt.innerText = `⭐ ${name}`;
          optgroup.appendChild(opt);
        });
        presetSelect.appendChild(optgroup);
      }
    },

    /**
     * Shows a confirmation dialog
     * @param {string} title - Dialog title
     * @param {string} message - Dialog message
     * @param {Function} onConfirm - Callback on confirmation
     */
    showConfirmDialog(title, message, onConfirm) {
      // Create modal overlay
      const dialogOverlay = document.createElement('div');
      dialogOverlay.id = 'te-confirm-overlay';
      dialogOverlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.85); z-index: 9999999;
                display: flex; align-items: center; justify-content: center;
            `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
                background: linear-gradient(145deg, #1a1a2e, #16213e);
                border: 2px solid #e94560; border-radius: 16px; padding: 24px;
                max-width: 400px; text-align: center;
                box-shadow: 0 20px 60px rgba(0,0,0,0.6);
                animation: te-dialog-in 0.2s ease;
            `;
      dialog.innerHTML = `
                <h3 style="color:#e94560;margin:0 0 16px;font-size:20px;">${sanitizeText(title)}</h3>
                <p style="color:#a0a0a0;margin:0 0 24px;font-size:14px;">${sanitizeText(message)}</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button id="te-confirm-cancel" style="padding:10px 24px;background:#f0f0f0;color:#000;border:none;border-radius:500px;font-weight:bold;cursor:pointer;font-size:14px;transition:transform 0.1s;">Cancel</button>
                    <button id="te-confirm-ok" style="padding:10px 24px;background:#e94560;color:#fff;border:none;border-radius:500px;font-weight:bold;cursor:pointer;font-size:14px;transition:transform 0.1s;">Confirm</button>
                </div>
            `;

      dialogOverlay.appendChild(dialog);
      document.body.appendChild(dialogOverlay);

      // Add animation keyframe
      if (!document.getElementById('te-dialog-styles')) {
        const style = document.createElement('style');
        style.id = 'te-dialog-styles';
        style.textContent = `
                    @keyframes te-dialog-in { from { opacity:0; transform:scale(0.9); } to { opacity:1; transform:scale(1); } }
                `;
        document.head.appendChild(style);
      }

      // Focus the cancel button
      dialog.querySelector('#te-confirm-cancel').focus();

      // Event handlers
      const closeDialog = () => dialogOverlay.remove();

      // Prevent clicks inside dialog from bubbling to overlay
      dialog.onclick = (e) => e.stopPropagation();

      dialog.querySelector('#te-confirm-cancel').onclick = (e) => {
        e.stopPropagation();
        closeDialog();
      };
      dialog.querySelector('#te-confirm-ok').onclick = (e) => {
        e.stopPropagation();
        closeDialog();
        onConfirm();
      };
      dialogOverlay.onclick = (e) => {
        if (e.target === dialogOverlay) closeDialog();
      };

      // Escape key to close
      const handleEsc = (e) => {
        if (e.key === 'Escape') {
          closeDialog();
          document.removeEventListener('keydown', handleEsc);
        }
      };
      document.addEventListener('keydown', handleEsc);
    },

    /**
     * Refreshes the panel UI with current config values
     */
    refreshPanel() {
      if (!this.panel) return;
      const wasVisible = this.panel.style.display !== 'none';
      // Remove both panel and overlay
      this.panel.remove();
      this.panel = null;
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      if (wasVisible) {
        this.createPanel();
        this.panel.style.display = 'block';
        this.overlay.style.display = 'block';
        this.panel.focus();
      }
    },

    /**
     * Toggles the theme editor panel visibility with focus management
     */
    toggle() {
      if (!this.panel) this.createPanel();
      const isHidden = this.panel.style.display === 'none';
      this.panel.style.display = isHidden ? 'block' : 'none';
      this.overlay.style.display = isHidden ? 'block' : 'none';

      // Focus management for accessibility
      if (isHidden) {
        this.previousActiveElement = document.activeElement;
        this.panel.focus();
      } else {
        this.cancelPreview(); // Cancel any active preview
        if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
          this.previousActiveElement.focus();
        }
      }
    },

  };

  // ==========================================================================================
  // 🧩 MODULE: FEATURES (Complex logic from Code 1)
  // ==========================================================================================
  const Features = {
    SongColor: {
      style: null,
      lastTrackUri: null,
      init() {
        if (Spicetify.Player) {
          Spicetify.Player.addEventListener('songchange', () => { this.lastTrackUri = null; this.apply(); });
          setTimeout(() => this.apply(), 2000);
        } else { setTimeout(() => this.init(), 1000); }
      },
      /**
       * Extracts dominant colors from an image using enhanced sampling
       * @param {string} imgSrc - The image URL
       * @returns {Promise<string[]>} Array of RGB color strings
       */
      extractColorsFromImage(imgSrc) {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 64; // Slightly larger for better sampling
            canvas.width = size;
            canvas.height = size;
            ctx.drawImage(img, 0, 0, size, size);

            try {
              const data = ctx.getImageData(0, 0, size, size).data;
              const colorMap = new Map();

              // Sample more points across the image (9x9 grid = 81 points)
              const step = Math.floor(size / 9);
              for (let y = step; y < size - step; y += step) {
                for (let x = step; x < size - step; x += step) {
                  const i = (y * size + x) * 4;
                  const r = data[i];
                  const g = data[i + 1];
                  const b = data[i + 2];

                  // Skip very dark or very light colors
                  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                  if (brightness < 20 || brightness > 235) continue;

                  // Quantize colors to reduce variations (group similar colors)
                  const qr = Math.round(r / 32) * 32;
                  const qg = Math.round(g / 32) * 32;
                  const qb = Math.round(b / 32) * 32;
                  const key = `${qr},${qg},${qb}`;

                  colorMap.set(key, (colorMap.get(key) || 0) + 1);
                }
              }

              // Sort by frequency and pick top colors
              const sortedColors = [...colorMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([key]) => {
                  const [r, g, b] = key.split(',').map(Number);
                  return `rgb(${r}, ${g}, ${b})`;
                });

              // Ensure we always have at least 4 colors
              while (sortedColors.length < 4) {
                sortedColors.push(sortedColors[0] || '#1a1a2e');
              }

              resolve(sortedColors);
            } catch (e) {
              console.warn('[Theme Editor] Color extraction failed:', e.message);
              resolve(['#1a1a2e', '#16213e', '#0f3460', '#1a1a2e']);
            }
          };
          img.onerror = () => {
            console.warn('[Theme Editor] Failed to load image for color extraction');
            resolve(['#1a1a2e', '#16213e', '#0f3460', '#1a1a2e']);
          };
          img.src = imgSrc;
        });
      },
      async apply(force = false) {
        if (Config.get('preset') !== '🎵 Song Color') { if (this.style) this.style.innerHTML = ''; this.lastTrackUri = null; return; }
        const track = Spicetify.Player.data?.item;
        if (!track) { console.log('[Theme Editor] SongColor: No track data'); return; }
        if (!force && track.uri === this.lastTrackUri) return;
        this.lastTrackUri = track.uri;

        // Try multiple ways to get album art
        let artUrl = '';
        if (track.metadata?.image_xlarge_url) artUrl = track.metadata.image_xlarge_url;
        else if (track.metadata?.image_large_url) artUrl = track.metadata.image_large_url;
        else if (track.metadata?.image_url) artUrl = track.metadata.image_url;
        else if (track.album?.images?.[0]?.url) artUrl = track.album.images[0].url;

        // Convert to https if needed
        if (artUrl && artUrl.startsWith('spotify:image:')) {
          artUrl = 'https://i.scdn.co/image/' + artUrl.replace('spotify:image:', '');
        }

        if (!artUrl) { console.log('[Theme Editor] SongColor: No art URL found'); return; }
        console.log('[Theme Editor] SongColor: Applying with URL:', artUrl);

        const colors = await this.extractColorsFromImage(artUrl);
        if (!this.style) { this.style = document.createElement('style'); this.style.id = 'theme-editor-song-color'; document.head.appendChild(this.style); }
        this.style.innerHTML = `
                    html, body, .Root, .Root__top-container { background: linear-gradient(rgba(30,30,30,0.6), rgba(30,30,30,0.8)), linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 30%, ${colors[2]} 60%, ${colors[3] || colors[1]} 100%) !important; background-attachment: fixed !important; background-size: cover !important; background-blend-mode: normal !important; transition: background 1s ease !important; }
                    .Root__main-view, .main-rootlist-rootlist, .main-rootlist-wrapper, .Root__nav-bar, .main-yourLibraryX-entryPoints, .main-yourLibraryX-header, .main-yourLibraryX-list, .main-yourLibraryX-libraryContainer, .main-navBar-entryPoints, aside, nav, #global-nav-bar, [data-testid="global-nav-bar"], .main-nowPlayingBar-container, .main-nowPlayingBar-nowPlayingBar, .Root__now-playing-bar, footer, .main-view-container, .main-home-homeHeader, .main-entityHeader-overlay, .main-actionBarBackground-background, .main-entityHeader-backgroundColor, .main-actionBar-actionBar, .main-coverSlotExpanded-container, .main-nowPlayingView-content, .main-nowPlayingView-section, .main-buddyFeed-container { background: transparent !important; background-color: transparent !important; background-image: none !important; box-shadow: none !important; border: none !important; }
                    .main-yourLibraryX-isScrolled, .Box-sc-8t9c76-0 { background-color: transparent !important; }
                    .main-card-card { background: rgba(255,255,255,0.05) !important; backdrop-filter: blur(5px) !important; }
                `;
      }
    },

    NextSong: {
      element: null,
      init() {
        if (Spicetify.Player) {
          Spicetify.Player.addEventListener('songchange', () => { setTimeout(() => this.update(), TIMING.SONG_CHANGE_DELAY); });
          Spicetify.Player.addEventListener('onplaypause', () => setTimeout(() => this.update(), TIMING.QUEUE_UPDATE_DELAY));
          if (Spicetify.Platform?.PlayerAPI) {
            Spicetify.Platform.PlayerAPI._events.addListener('queue_update', () => setTimeout(() => this.update(), TIMING.QUEUE_UPDATE_DELAY));
            Spicetify.Platform.PlayerAPI._events.addListener('update', () => setTimeout(() => this.update(), TIMING.QUEUE_UPDATE_DELAY));
          }
          // Removed unnecessary setInterval polling - event-based updates are sufficient
          setTimeout(() => this.update(), TIMING.TOAST_DURATION);
        }
      },
      update() {
        if (!Config.get('showNextSong')) { if (this.element) { this.element.remove(); this.element = null; } return; }
        try {
          // GUEST MODE LOGIC
          if (SyncSession.isActive && !SyncSession.isHost && SyncSession.remoteNextTrack) {
            this.render(SyncSession.remoteNextTrack);
            return;
          }

          const queue = Spicetify.Queue;
          if (!queue || !queue.nextTracks || queue.nextTracks.length === 0) { if (this.element) { this.element.remove(); this.element = null; } return; }
          const currentUri = Spicetify.Player?.data?.item?.uri || '';
          let nextTrack = null;
          for (let i = 0; i < queue.nextTracks.length; i++) {
            const track = queue.nextTracks[i]?.contextTrack;
            if (track && track.uri !== currentUri) { nextTrack = track.metadata; break; }
          }
          if (!nextTrack) { if (this.element) { this.element.remove(); this.element = null; } return; }
          this.render(nextTrack);
        } catch (e) { }
      },
      render(nextTrack) {
        const nowPlayingWidget = document.querySelector('[data-testid="now-playing-widget"]') || document.querySelector('.main-nowPlayingWidget-nowPlaying');
        if (!nowPlayingWidget) return;
        const parentContainer = nowPlayingWidget.closest('.main-nowPlayingBar-left') || nowPlayingWidget.parentElement;
        if (!this.element) { this.element = document.createElement('div'); this.element.id = 'te-next-song'; }
        this.element.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:3px 8px;background:rgba(255,255,255,0.08);border-radius:6px;max-width:160px;vertical-align:middle;flex-shrink:0;';

        // Sanitize all user content to prevent XSS
        const safeImgUrl = sanitizeUrl(nextTrack.image_url || nextTrack.image_small_url || '');
        const safeTitle = sanitizeText(nextTrack.title || 'Unknown');
        const safeArtist = sanitizeText(nextTrack.artist_name || '');

        // Build element safely using DOM APIs
        this.element.innerHTML = '';
        const nextLabel = document.createElement('span');
        nextLabel.style.cssText = 'color:#666;font-size:8px;white-space:nowrap;';
        nextLabel.textContent = 'NEXT';
        this.element.appendChild(nextLabel);

        if (safeImgUrl) {
          const img = document.createElement('img');
          img.src = safeImgUrl;
          img.style.cssText = 'width:24px;height:24px;border-radius:3px;flex-shrink:0;';
          this.element.appendChild(img);
        }

        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'overflow:hidden;max-width:90px;';
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-size:10px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        titleDiv.textContent = safeTitle;
        const artistDiv = document.createElement('div');
        artistDiv.style.cssText = 'font-size:8px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        artistDiv.textContent = safeArtist;
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(artistDiv);
        this.element.appendChild(infoDiv);
        if (!parentContainer.contains(this.element)) { parentContainer.style.display = 'flex'; parentContainer.style.alignItems = 'center'; parentContainer.appendChild(this.element); }
      }
    },

    Rewind: {
      init() {
        const REWIND_NAMESPACE = 'te-rewind';
        const REWIND_AUDIO_URL = 'https://cdn.jsdelivr.net/gh/NickColley/spicetify-rewind/rewind.mp3';
        const REWIND_AUDIO_START = 0.612; const REWIND_AUDIO_END = 2.8;
        const rewindStyles = document.createElement('style');
        rewindStyles.textContent = `.${REWIND_NAMESPACE}--playing { animation: ${REWIND_NAMESPACE}-playing 1s linear infinite; } .${REWIND_NAMESPACE}--rewind { animation: ${REWIND_NAMESPACE}-rewind ${REWIND_AUDIO_END}s; } @keyframes ${REWIND_NAMESPACE}-playing { 100% { transform: rotate(360deg); } } @keyframes ${REWIND_NAMESPACE}-rewind { 0% { transform: rotate(0deg); } 100% { transform: rotate(-10000deg); } }`;
        document.head.appendChild(rewindStyles);

        function waitForRewindElement(selector) {
          return new Promise(resolve => {
            if (document.querySelector(selector)) return resolve(document.querySelector(selector));
            const observer = new MutationObserver(() => { if (document.querySelector(selector)) { observer.disconnect(); resolve(document.querySelector(selector)); } });
            observer.observe(document.body, { childList: true, subtree: true });
          });
        }
        waitForRewindElement("[aria-label='Player controls']").then($playerControls => {
          const $existingBackButton = $playerControls.querySelector("button[aria-label='Previous']");
          if (!$existingBackButton || document.querySelector('#te-rewind-btn')) return;
          const audioClip = new Audio(REWIND_AUDIO_URL); audioClip.currentTime = REWIND_AUDIO_START;
          const $button = document.createElement('button'); $button.id = 'te-rewind-btn'; $button.className = $existingBackButton.className;
          $button.innerHTML = $existingBackButton.innerHTML; $button.setAttribute('aria-label', 'Rewind'); $button.title = 'Rewind to Start';
          let audioTimer = null; let isPlaying = Spicetify.Player.isPlaying();
          const $icon = $button.querySelector('svg'); $icon.setAttribute('viewBox', '0 0 55.33 55.33');
          $icon.innerHTML = '<circle cx="28.16" cy="27.67" r="3.37"/><path d="M28.16 1.89a25.78 25.78 0 1 0-.99 51.55 25.78 25.78 0 0 0 .99-51.55Zm-9.83 6.4a21.63 21.63 0 0 1 10.44-2.32c.34 0 .58.85.53 1.88l-.27 5.29c-.05 1.02-.27 1.85-.48 1.84h-.4c-1.86 0-3.63.4-5.21 1.12-.94.42-2.07.17-2.6-.72l-2.7-4.57a1.79 1.79 0 0 1 .69-2.51Zm-1.06 9.72-3.98-3.5a1.73 1.73 0 0 1-.06-2.6 1.7 1.7 0 0 1 2.54.24l3.26 4.17c.64.81.78 1.77.37 2.16-.42.4-1.35.2-2.13-.47Zm1.76 9.66a9.12 9.12 0 1 1 18.25 0 9.12 9.12 0 0 1-18.25 0Zm18.9 19.38a21.62 21.62 0 0 1-10.46 2.32c-.39-.01-.66-.87-.6-1.9l.29-5.28c.05-1.03.3-1.85.55-1.84h.45c1.7 0 3.33-.33 4.82-.94.95-.4 2.12-.13 2.68.73l2.88 4.44c.56.87.32 2.01-.6 2.48Zm5.09-3.55c-.72.67-1.87.51-2.52-.28l-3.35-4.12c-.66-.79-.81-1.71-.4-2.1.4-.37 1.34-.16 2.11.52L42.85 41c.78.68.88 1.83.17 2.5Z"/>';
          $button.addEventListener('click', () => {
            if (audioTimer) { audioClip.pause(); audioClip.currentTime = REWIND_AUDIO_START; clearTimeout(audioTimer); }
            const vol = Math.min(Spicetify.Player.getVolume(), 0.8); audioClip.volume = Math.pow(vol, 3).toFixed(2); audioClip.play();
            if (isPlaying) Spicetify.Player.pause(); Spicetify.Player.seek(0); $icon.classList.add(`${REWIND_NAMESPACE}--rewind`);
            audioTimer = setTimeout(() => { audioClip.pause(); audioClip.currentTime = REWIND_AUDIO_START; Spicetify.Player.play(); $icon.classList.remove(`${REWIND_NAMESPACE}--rewind`); }, REWIND_AUDIO_END * 1000);
          });
          Spicetify.Player.addEventListener('onplaypause', () => { isPlaying = Spicetify.Player.isPlaying(); $icon.classList.toggle(`${REWIND_NAMESPACE}--playing`, isPlaying); if (isPlaying && !audioClip.paused) { audioClip.pause(); audioClip.currentTime = REWIND_AUDIO_START; } });
          if (isPlaying) $icon.classList.add(`${REWIND_NAMESPACE}--playing`);
          $existingBackButton.before($button);
        });
      }
    },

    Adblock: {
      async init() {
        // ==========================================================================================
        // 🛡️ SUB-MODULE: ADBLOCK (Full Integration - adblockify by ririxi)
        // ==========================================================================================
        const loadWebpack = () => {
          try {
            const require = window.webpackChunkclient_web.push([[Symbol()], {}, (re) => re]);
            const cache = Object.keys(require.m).map(id => require(id));
            const modules = cache
              .filter(module => typeof module === "object")
              .flatMap(module => {
                try {
                  return Object.values(module);
                } catch { }
              });
            const functionModules = modules.filter(module => typeof module === "function");
            return { cache, functionModules };
          } catch (error) {
            console.error("adblockify: Failed to load webpack", error);
            return { cache: [], functionModules: [] };
          }
        };

        const getSettingsClient = (cache, functionModules = [], transport = {}) => {
          try {
            const settingsClient = cache.find((m) => m?.settingsClient)?.settingsClient;
            if (!settingsClient) {
              const settings = functionModules.find(m => m?.SERVICE_ID === "spotify.ads.esperanto.settings.proto.Settings" || m?.SERVICE_ID === "spotify.ads.esperanto.proto.Settings");
              return new settings(transport);
            }
            return settingsClient;
          } catch (error) {
            console.error("adblockify: Failed to get ads settings client", error);
            return null;
          }
        };

        const getSlotsClient = (functionModules, transport) => {
          try {
            const slots = functionModules.find(m => m.SERVICE_ID === "spotify.ads.esperanto.slots.proto.Slots" || m.SERVICE_ID === "spotify.ads.esperanto.proto.Slots");
            return new slots(transport);
          } catch (error) {
            console.error("adblockify: Failed to get slots client", error);
            return null;
          }
        };

        const getTestingClient = (functionModules, transport) => {
          try {
            const testing = functionModules.find(m => m.SERVICE_ID === "spotify.ads.esperanto.testing.proto.Testing" || m.SERVICE_ID === "spotify.ads.esperanto.proto.Testing");
            return new testing(transport);
          } catch (error) {
            console.error("adblockify: Failed to get testing client", error);
            return null;
          }
        };

        const map = new Map();
        const retryCounter = (slotId, action) => {
          if (!map.has(slotId)) map.set(slotId, { count: 0 });
          if (action === "increment") map.get(slotId).count++;
          else if (action === "clear") map.delete(slotId);
          else if (action === "get") return map.get(slotId)?.count;
        };

        // @ts-expect-error: Events are not defined in types
        await new Promise(res => Spicetify.Events.platformLoaded.on(res));
        // @ts-expect-error: Events are not defined in types
        await new Promise(res => Spicetify.Events.webpackLoaded.on(res));
        const webpackCache = loadWebpack();

        const { Platform, Locale } = Spicetify;
        const { AdManagers } = Platform;
        if (!AdManagers?.audio || Object.keys(AdManagers).length === 0) {
          setTimeout(() => this.init(), 100);
          return;
        }
        const { audio } = AdManagers;
        const { UserAPI } = Platform;
        const productState = UserAPI._product_state || UserAPI._product_state_service || Platform?.ProductStateAPI?.productStateApi;
        if (!Spicetify?.CosmosAsync) {
          setTimeout(() => this.init(), 100);
          return;
        }
        const { CosmosAsync } = Spicetify;

        let slots = [];
        const slotsClient = getSlotsClient(webpackCache.functionModules, productState.transport);
        if (slotsClient) slots = (await slotsClient.getSlots()).adSlots;
        else slots = await CosmosAsync.get("sp://ads/v1/slots");

        const hideAdLikeElements = () => {
          const css = document.createElement("style");
          const upgradeText = Locale.get("upgrade.tooltip.title");
          css.className = "adblockify";
          css.innerHTML = `.sl_aPp6GDg05ItSfmsS7, .nHCJskDZVlmDhNNS9Ixv, .utUDWsORU96S7boXm2Aq, .cpBP3znf6dhHLA2dywjy, .G7JYBeU1c2QawLyFs5VK, .vYl1kgf1_R18FCmHgdw2, .vZkc6VwrFz0EjVBuHGmx, .iVAZDcTm1XGjxwKlQisz, ._I_1HMbDnNlNAaViEnbp, .xXj7eFQ8SoDKYXy6L3E1, .F68SsPm8lZFktQ1lWsQz, .MnW5SczTcbdFHxLZ_Z8j, .WiPggcPDzbwGxoxwLWFf, .ReyA3uE3K7oEz7PTTnAn, .x8e0kqJPS0bM4dVK7ESH, .gZ2Nla3mdRREDCwybK6X, .SChMe0Tert7lmc5jqH01, .AwF4EfqLOIJ2xO7CjHoX, .UlkNeRDFoia4UDWtrOr4, .k_RKSQxa2u5_6KmcOoSw, ._mWmycP_WIvMNQdKoAFb, .O3UuqEx6ibrxyOJIdpdg, .akCwgJVf4B4ep6KYwrk5, .bIA4qeTh_LSwQJuVxDzl, .ajr9pah2nj_5cXrAofU_, .gvn0k6QI7Yl_A0u46hKn, .obTnuSx7ZKIIY1_fwJhe, .IiLMLyxs074DwmEH4x5b, .RJjM91y1EBycwhT_wH59, .mxn5B5ceO2ksvMlI1bYz, .l8wtkGVi89_AsA3nXDSR, .Th1XPPdXMnxNCDrYsnwb, .SJMBltbXfqUiByDAkUN_, .Nayn_JfAUsSO0EFapLuY, .YqlFpeC9yMVhGmd84Gdo, .HksuyUyj1n3aTnB4nHLd, .DT8FJnRKoRVWo77CPQbQ, ._Cq69xKZBtHaaeMZXIdk, .main-leaderboardComponent-container, .sponsor-container, a.link-subtle.main-navBar-navBarLink.GKnnhbExo0U9l7Jz2rdc, button[title="${upgradeText}"], button[aria-label="${upgradeText}"], .main-topBar-UpgradeButton, .main-contextMenu-menuItem a[href^="https://www.spotify.com/premium/"], div[data-testid*="hpto"] {display: none !important;}`;
          document.head.appendChild(css);
        };

        const disableAds = async () => {
          try {
            await productState.putOverridesValues({ pairs: { ads: "0", catalogue: "premium", product: "premium", type: "premium" } });
          } catch (error) {
            console.error("adblockify: Failed inside `disableAds` function\n", error);
          }
        };

        const configureAdManagers = async () => {
          try {
            const { billboard, leaderboard, sponsoredPlaylist } = AdManagers;
            const testingClient = getTestingClient(webpackCache.functionModules, productState.transport);

            if (testingClient) testingClient.addPlaytime({ seconds: -100000000000 });
            else await CosmosAsync.post("sp://ads/v1/testing/playtime", { value: -100000000000 });

            await audio.disable();
            audio.isNewAdsNpvEnabled = false;
            await billboard.disable();
            await leaderboard.disableLeaderboard();
            await sponsoredPlaylist.disable();
            if (AdManagers?.inStreamApi) {
              const { inStreamApi } = AdManagers;
              await inStreamApi.disable();
            }
            if (AdManagers?.vto) {
              const { vto } = AdManagers;
              await vto.manager.disable();
              vto.isNewAdsNpvEnabled = false;
            }
            setTimeout(disableAds, 100);
          } catch (error) {
            console.error("adblockify: Failed inside `configureAdManagers` function\n", error);
          }
        };

        const bindToSlots = async () => {
          for (const slot of slots) {
            subToSlot(slot.slotId || slot.slot_id);
            setTimeout(() => handleAdSlot({ adSlotEvent: { slotId: slot.slotId || slot.slot_id } }), 50);
          }
        };

        const handleAdSlot = (data) => {
          const slotId = data?.adSlotEvent?.slotId;

          try {
            const adsCoreConnector = audio?.inStreamApi?.adsCoreConnector;
            if (typeof adsCoreConnector?.clearSlot === "function") adsCoreConnector.clearSlot(slotId);
            const slotsClient = getSlotsClient(webpackCache.functionModules, productState.transport);
            if (slotsClient) slotsClient.clearAllAds({ slotId });
            updateSlotSettings(slotId);
          } catch (error) {
            console.error("adblockify: Failed inside `handleAdSlot` function. Retrying in 1 second...\n", error);
            retryCounter(slotId, "increment");
            if (retryCounter(slotId, "get") > 5) {
              console.error(`adblockify: Failed inside \`handleAdSlot\` function for 5th time. Giving up...\nSlot id: ${slotId}.`);
              retryCounter(slotId, "clear");
              return;
            }
            setTimeout(handleAdSlot, 1 * 1000, data);
          }
          configureAdManagers();
        };

        const updateSlotSettings = async (slotId) => {
          try {
            const settingsClient = getSettingsClient(webpackCache.cache, webpackCache.functionModules, productState.transport);
            if (!settingsClient) return;
            await settingsClient.updateAdServerEndpoint({ slotIds: [slotId], url: "http://localhost/no/thanks" });
            await settingsClient.updateStreamTimeInterval({ slotId, timeInterval: "0" });
            await settingsClient.updateSlotEnabled({ slotId, enabled: false });
            await settingsClient.updateDisplayTimeInterval({ slotId, timeInterval: "0" });
          } catch (error) {
            console.error("adblockify: Failed inside `updateSlotSettings` function\n", error);
          }
        };

        const intervalUpdateSlotSettings = async () => {
          for (const slot of slots) {
            updateSlotSettings(slot.slotId || slot.slot_id);
          }
        };

        const subToSlot = (slot) => {
          try {
            audio.inStreamApi.adsCoreConnector.subscribeToSlot(slot, handleAdSlot);
          } catch (error) {
            console.error("adblockify: Failed inside `subToSlot` function\n", error);
          }
        };

        const enableExperimentalFeatures = async () => {
          try {
            const expFeatures = JSON.parse(localStorage.getItem("spicetify-exp-features") || "{}");
            if (typeof expFeatures?.enableEsperantoMigration?.value !== "undefined") expFeatures.enableEsperantoMigration.value = true;
            if (typeof expFeatures?.enableInAppMessaging?.value !== "undefined") expFeatures.enableInAppMessaging.value = false;
            if (typeof expFeatures?.hideUpgradeCTA?.value !== "undefined") expFeatures.hideUpgradeCTA.value = true;
            if (typeof expFeatures?.enablePremiumUserForMiniPlayer?.value !== "undefined") expFeatures.enablePremiumUserForMiniPlayer.value = true;
            localStorage.setItem("spicetify-exp-features", JSON.stringify(expFeatures));
            const overrides = {
              enableEsperantoMigration: true,
              enableInAppMessaging: false,
              hideUpgradeCTA: true,
              enablePremiumUserForMiniPlayer: true,
            };

            // @ts-expect-error: RemoteConfigResolver is not defined in types
            if (Spicetify?.RemoteConfigResolver) {
              // @ts-expect-error: createInternalMap is not defined in types
              const map = Spicetify.createInternalMap(overrides);
              // @ts-expect-error: RemoteConfigResolver is not defined in types
              Spicetify.RemoteConfigResolver.value.setOverrides(map);
            } else if (Spicetify.Platform?.RemoteConfigDebugAPI) {
              const RemoteConfigDebugAPI = Spicetify.Platform.RemoteConfigDebugAPI;

              for (const [key, value] of Object.entries(overrides)) {
                await RemoteConfigDebugAPI.setOverride({ source: "web", type: "boolean", name: key }, value);
              }
            }
          } catch (error) {
            console.error("adblockify: Failed inside `enableExperimentalFeatures` function\n", error);
          }
        };

        bindToSlots();
        hideAdLikeElements();
        productState.subValues({ keys: ["ads", "catalogue", "product", "type"] }, () => configureAdManagers());
        enableExperimentalFeatures();
        setTimeout(enableExperimentalFeatures, 3 * 1000);
        // Update slot settings after 5 seconds... idk why, don't ask me why, it just works
        setTimeout(intervalUpdateSlotSettings, 5 * 1000);
      }
    },

    LoopyLoop: {
      async init() {
        const bar = document.querySelector(".playback-bar .progress-bar");
        if (!(bar && Spicetify.React)) { setTimeout(() => this.init(), 100); return; }
        if (Spicetify.Events?.webpackLoaded) await new Promise((res) => Spicetify.Events.webpackLoaded.on(res));
        const style = document.createElement("style");
        style.innerHTML = `#loopy-loop-start, #loopy-loop-end { position: absolute; font-weight: bolder; font-size: 15px; top: -7px; color: #1db954; }`;
        const startMark = document.createElement("div"); startMark.id = "loopy-loop-start"; startMark.innerText = "[";
        const endMark = document.createElement("div"); endMark.id = "loopy-loop-end"; endMark.innerText = "]";
        startMark.style.position = endMark.style.position = "absolute"; startMark.hidden = endMark.hidden = true;
        bar.append(style, startMark, endMark);
        let start = null, end = null, mouseOnBarPercent = 0.0;
        function drawOnBar() { if (start === null && end === null) { startMark.hidden = endMark.hidden = true; return; } startMark.hidden = endMark.hidden = false; startMark.style.left = `${start * 100}%`; endMark.style.left = `${end * 100}%`; }
        function reset() { start = null; end = null; drawOnBar(); }
        let debouncing = 0;
        Spicetify.Player.addEventListener("onprogress", (event) => { if (start != null && end != null) { if (debouncing) { if (event.timeStamp - debouncing > 1000) debouncing = 0; return; } const percent = Spicetify.Player.getProgressPercent(); if (percent > end || percent < start) { debouncing = event.timeStamp; Spicetify.Player.seek(start); } } });
        Spicetify.Player.addEventListener("songchange", reset);
        function createMenuItem(title, callback) { const wrapper = document.createElement("div"); Spicetify.ReactDOM.render(Spicetify.React.createElement(Spicetify.ReactComponent.MenuItem, { onClick: () => { contextMenu.hidden = true; callback?.(); } }, title), wrapper); return wrapper; }
        const startBtn = createMenuItem("Set Loop Start", () => { start = mouseOnBarPercent; if (end === null || start > end) end = 0.99; drawOnBar(); });
        const endBtn = createMenuItem("Set Loop End", () => { end = mouseOnBarPercent; if (start === null || end < start) start = 0; drawOnBar(); });
        const resetBtn = createMenuItem("Reset Loop", reset);
        const contextMenu = document.createElement("div"); contextMenu.id = "loopy-context-menu";
        contextMenu.innerHTML = `<ul tabindex="0" class="main-contextMenu-menu"></ul>`;
        contextMenu.style.cssText = "position:absolute;z-index:9999;background:var(--spice-card);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.5);";
        contextMenu.firstElementChild.append(startBtn, endBtn, resetBtn);
        document.body.append(contextMenu);
        const { height: contextMenuHeight } = contextMenu.getBoundingClientRect(); contextMenu.hidden = true;

        // Register with CleanupManager to prevent memory leaks
        const handleWindowClick = () => { contextMenu.hidden = true; };
        window.addEventListener("click", handleWindowClick);
        CleanupManager.addListener(window, "click", handleWindowClick);

        bar.oncontextmenu = (event) => { const { x, width } = bar.firstElementChild.getBoundingClientRect(); mouseOnBarPercent = (event.clientX - x) / width; contextMenu.style.transform = `translate(${event.clientX}px,${event.clientY - contextMenuHeight}px)`; contextMenu.hidden = false; event.preventDefault(); };
      }
    },

    ShufflePlus: {
      async init() {
        if (!(Spicetify.CosmosAsync && Spicetify.Platform)) { setTimeout(() => this.init(), 300); return; }
        const { Type } = Spicetify.URI;
        function shuffle(array) { let counter = array.length; while (counter > 0) { const index = Math.floor(Math.random() * counter); counter--; const temp = array[counter]; array[counter] = array[index]; array[index] = temp; } return array.filter(Boolean); }
        async function fetchPlaylistTracks(uri) { const res = await Spicetify.Platform.PlaylistAPI.getContents(`spotify:playlist:${uri}`, { limit: 9999999 }); return res.items.filter((track) => track.isPlayable).map((track) => track.uri); }
        async function fetchAlbumTracks(uri) { const { queryAlbumTracks } = Spicetify.GraphQL.Definitions; const { data, errors } = await Spicetify.GraphQL.Request(queryAlbumTracks, { uri, offset: 0, limit: 100 }); if (errors) throw errors[0].message; return (data.albumUnion?.tracksV2 ?? data.albumUnion?.tracks ?? []).items.filter(({ track }) => track.playability.playable).map(({ track }) => track.uri); }
        async function fetchLikedTracks() { const res = await Spicetify.CosmosAsync.get("sp://core-collection/unstable/@/list/tracks/all?responseFormat=protobufJson"); return res.item.filter((track) => track.trackMetadata.playable).map((track) => track.trackMetadata.link); }
        async function Queue(list, context) { const count = list.length; list.push("spotify:delimiter"); const { _queue, _client } = Spicetify.Platform.PlayerAPI._queue; const { prevTracks, queueRevision } = _queue; const nextTracks = list.map((uri) => ({ contextTrack: { uri, uid: "", metadata: { is_queued: "false" } }, removed: [], blocked: [], provider: "context" })); _client.setQueue({ nextTracks, prevTracks, queueRevision }); if (context) { const { sessionId } = Spicetify.Platform.PlayerAPI.getState(); Spicetify.Platform.PlayerAPI.updateContext(sessionId, { uri: context, url: `context://${context}` }); } Spicetify.Player.next(); Spicetify.showNotification(`Shuffled ${count} Songs`); }
        async function fetchAndPlay(rawUri) {
          let list, context = null;
          try {
            if (typeof rawUri === "object") { list = rawUri; } else {
              const uriObj = Spicetify.URI.fromString(rawUri); const type = uriObj.type; const uri = uriObj._base62Id ?? uriObj.id;
              switch (type) {
                case Type.PLAYLIST: case Type.PLAYLIST_V2: list = await fetchPlaylistTracks(uri); break;
                case Type.ALBUM: list = await fetchAlbumTracks(rawUri); break;
                case Type.COLLECTION: list = await fetchLikedTracks(); break;
                default: Spicetify.showNotification("Unsupported type", true); return;
              }
              context = rawUri;
            }
            if (!list?.length) { Spicetify.showNotification("Nothing to play", true); return; }
            await Queue(shuffle(list), context);
          } catch (error) { Spicetify.showNotification(String(error), true); console.error(error); }
        }
        function shouldAddShufflePlus(uri) { if (uri.length === 1) { const uriObj = Spicetify.URI.fromString(uri[0]); switch (uriObj.type) { case Type.PLAYLIST: case Type.PLAYLIST_V2: case Type.ALBUM: case Type.COLLECTION: return true; } } return uri.length > 1; }
        new Spicetify.ContextMenu.Item("Play with Shuffle+", async (uri) => { await fetchAndPlay(uri.length === 1 ? uri[0] : uri); }, shouldAddShufflePlus, "shuffle").register();
      }
    },

    // ==========================================================================================
    // 📱 SCANNABLES - View scannable code for any track or playlist
    // ==========================================================================================
    Scannables: {
      init() {
        if (!(Spicetify.Platform.ClipboardAPI && Spicetify.URI && Spicetify.ContextMenu)) {
          setTimeout(() => this.init(), 10);
          return;
        }

        function showScannable(uris) {
          var style = document.createElement("style");
          var overlay = document.createElement("div");
          var image = document.createElement("img");
          var SVG = `
                        <div class="centered">
                            <svg  width="48" height="48" viewBox="0 -960 960 960" style="fill: white;">
                                <path d="M180-81q-24 0-42-18t-18-42v-603h60v603h474v60H180Zm120-120q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h440q24 0 42 18t18 42v560q0 24-18 42t-42 18H300Zm0-60h440v-560H300v560Zm0 0v-560 560Z"></path>
                            </svg>
                        </div>`;

          // Validate and sanitize URI to prevent XSS
          const uri = uris[0];
          if (!uri || typeof uri !== 'string' || !uri.startsWith('spotify:')) {
            console.warn('[Theme Editor] Scannables: Invalid URI');
            return;
          }
          const safeUri = encodeURIComponent(uri);

          image.id = "image";
          image.loading = "eager";
          image.draggable = false;
          image.src = `https://scannables.scdn.co/uri/800/${safeUri}`;
          overlay.id = "overlay";
          overlay.innerHTML = image.outerHTML + SVG;
          style.textContent = `
                    .centered {
                      position: absolute;
                      top: 50%;
                      left: 50%;
                      transform: translate(-50%, -50%);
                      opacity: 0;
                      transition: opacity 0.3s ease;
                      pointer-events: none;
                    }
                    #overlay {
                      position: fixed;
                      top: 0;
                      left: 0;
                      width: 100%;
                      height: 100%;
                      background-color: rgba(var(--spice-rgb-shadow),.7);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                    }
                    #image {
                      max-width: 40%;
                      max-height: 40%;
                      transition: filter 0.3s ease;
                    }
                    #image:hover {
                      filter: brightness(0.5);
                    }
                    #image:hover + .centered {
                      opacity: 1;
                    }`;

          document.head.appendChild(style);
          document.body.appendChild(overlay);

          overlay.onclick = function (event) {
            if (event.target === overlay) {
              document.body.removeChild(overlay);
              document.head.removeChild(style);
            } else {
              Spicetify.Platform.ClipboardAPI.copy(`https://scannables.scdn.co/uri/1638/${uris[0]}`);
              document.querySelector("#overlay > div > svg").innerHTML = `<path d="M378-246 154-470l43-43 181 181 384-384 43 43-427 427Z"/>`;
            }
          };
        }

        function shouldEnable(uris) {
          if (uris.length > 1 || Spicetify.URI.isCollection(uris[0])) {
            return false;
          }
          return true;
        }

        new Spicetify.ContextMenu.Item(
          "Show Spotify Code",
          uris => showScannable(uris),
          uris => shouldEnable(uris),
          `<svg data-encore-id="icon" role="img" aria-hidden="true" viewBox="0 0 16 16" class="Svg-img-icon-small-textSubdued">
                        <rect x="0" y="4.065" width="1.5" height="7.87" rx="0.75" ry="0.75"></rect>
                        <rect x="2.9" y="0" width="1.5" height="16.00" rx="0.75" ry="0.75"></rect>
                        <rect x="5.8" y="2.89" width="1.5" height="10.22" rx="0.75" ry="0.75"></rect>
                        <rect x="8.7" y="5.92" width="1.5" height="4.16" rx="0.75" ry="0.75"></rect>
                        <rect x="11.5" y="1.465" width="1.5" height="13.07" rx="0.75" ry="0.75"></rect>
                        <rect x="14.5" y="4.065" width="1.5" height="7.87" rx="0.75" ry="0.75"></rect>
                    </svg>`
        ).register();
        console.log("[Theme Editor] Scannables initialized");
      }
    },

    // ==========================================================================================
    // 🔊 VOLUME PERCENTAGE - View/Modify volume percentage in a hoverable Tippy
    // ==========================================================================================
    VolumePercentage: {
      init() {
        const volumeBar = document.querySelector(".main-nowPlayingBar-volumeBar .progress-bar");
        const volumeSlider = document.querySelector(".main-nowPlayingBar-volumeBar .progress-bar__slider");

        if (!(volumeBar && volumeSlider && Spicetify.Platform.PlaybackAPI && Spicetify.Tippy && Spicetify.TippyProps)) {
          setTimeout(() => this.init(), 10);
          return;
        }

        // Mount Tippy
        const tippyInstance = Spicetify.Tippy(volumeBar, {
          ...Spicetify.TippyProps,
          hideOnClick: false,
          interactive: true,
          allowHTML: true,
          interactiveBorder: 20,
          onMount(instance) {
            Spicetify.TippyProps.onMount(instance);
            updatePercentage();
          }
        });

        // Update the Tippy content with the current volume percentage
        const updatePercentage = () => {
          const currVolume = Math.round(Spicetify.Platform.PlaybackAPI._volume * 100);
          tippyInstance.setContent(
            currVolume === -100
              ? ``
              : `
                            <div class="text">
                                <input id="volumeInput" type="text" maxLength="3" value="${currVolume}">
                                <style>
                                    .volume-bar__slider-container:focus-within { position: revert !important; }
                                    div.text { display: flex; align-items: center; }
                                    div.text:after { content: '%'; font-variant: unicase;}
                                    div.text input { min-width: 1ch; max-width: 3ch; padding: 0; font-size: 1em; text-align: center; border: 0; background: none; color: var(--spice-text); z-index: 1; outline: none !important; height: 1em; }
                                    div.text input::-webkit-outer-spin-button, div.text input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                                </style>
                            </div>
                            <div class="main-popper-arrow" style="bottom: -4px; position: absolute; left: calc(50% - 4px); background-color: var(--spice-card); width: 8px; height: 8px; transform: rotate(45deg); z-index: 0;"></div>
                            `
          );
          adjustWidth(document.querySelector("#volumeInput"));
        };

        // Event listeners for the tippy - registered with CleanupManager to prevent memory leaks
        const handleVolumeChange = async e => {
          if (e.target && e.target.id === "volumeInput") {
            e.target.value = Math.min(100, Math.max(0, e.target.value));
            Spicetify.Platform.PlaybackAPI.setVolume(Number(e.target.value) / 100);
            adjustWidth(e.target);
          }
        };

        const handleVolumeKeydown = e => {
          if (e.target && e.target.id === "volumeInput" && e.key.length == 1 && isNaN(Number(e.key))) {
            e.preventDefault();
          }
        };

        const handleVolumeInput = e => {
          if (e.target && e.target.id === "volumeInput") {
            adjustWidth(e.target);
          }
        };

        document.addEventListener("change", handleVolumeChange);
        document.addEventListener("keydown", handleVolumeKeydown);
        document.addEventListener("input", handleVolumeInput);

        // Register for cleanup to prevent memory leaks
        CleanupManager.addListener(document, "change", handleVolumeChange);
        CleanupManager.addListener(document, "keydown", handleVolumeKeydown);
        CleanupManager.addListener(document, "input", handleVolumeInput);

        // Event listener for the volume bar + volume event handler
        volumeSlider.addEventListener(
          "mousedown",
          event => {
            tippyInstance.setProps({ trigger: "mousedown" });

            const onMouseUp = event => {
              tippyInstance.setProps({ trigger: "mouseenter focus" });
              if (event.srcElement !== volumeSlider) tippyInstance.hide();
              document.removeEventListener("mouseup", onMouseUp);
            };

            document.addEventListener("mouseup", onMouseUp);
          },
          { capture: true }
        );

        let prevVolume = Spicetify.Platform.PlaybackAPI._volume;
        let hideTimeout;
        let isDragging = false;

        tippyInstance.popper.addEventListener("mouseenter", () => {
          clearTimeout(hideTimeout);
        });

        volumeBar.addEventListener("mouseenter", () => {
          clearTimeout(hideTimeout);
          isDragging = true;
        });

        volumeBar.addEventListener("mouseleave", event => {
          if (!event.buttons) {
            isDragging = false;
          }
        });

        Spicetify.Platform.PlaybackAPI._events.addListener("volume", e => {
          updatePercentage();

          if ((!tippyInstance.state.isVisible || hideTimeout) && !isDragging && e.data.volume !== prevVolume) {
            clearTimeout(hideTimeout);

            tippyInstance.show();
            hideTimeout = setTimeout(() => {
              tippyInstance.hide();
            }, 1000);
          }

          prevVolume = e.data.volume;
        });

        // Functions
        function adjustWidth(input) {
          if (!input) return;
          input.style.width = `${input.value.length}ch`;
          tippyInstance.popperInstance.update();
        }
        console.log("[Theme Editor] VolumePercentage initialized");
      }
    },

    // ==========================================================================================
    // 🌈 NPV AMBIENCE - Adds a colorful glow behind the Now Playing View image
    // ==========================================================================================
    NPVAmbience: {
      init() {
        // Append Styling To Head
        const style = document.createElement("style");
        style.id = "te-npv-ambience-style";
        style.textContent = ` 
                    .main-nowPlayingView-coverArtContainer::before,
                    .main-nowPlayingView-coverArtContainer::after {
                        content: "";
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        pointer-events: none;
                        background: var(--npv-ambience-img);
                        z-index: -1;
                        filter: blur(40px) saturate(2);
                        background-position: center;
                        background-size: cover;
                        transition: height 0.6s cubic-bezier(0, 0, 0, 1), background 0.5s ease, opacity 0.5s ease;
                        background-repeat: no-repeat;
                        opacity: var(--npv-ambience-opacity, 0);
                        height: var(--npv-ambience-width);
                        margin-top: 48px;
                    }

                    .main-nowPlayingView-coverArtContainer::after {
                        filter: blur(40px) contrast(2);
                    }

                    aside[aria-label="Now playing view"] .ZbDMGdU4aBOnrNLowNRq, aside[aria-label="Now playing view"] .W3E0IT3_STcazjTeyOJa {
                        position: absolute;
                        width: 100%;
                        z-index: 1;
                        background: transparent;
                        transition: background-color 0.25s, backdrop-filter 0.5s, opacity 0.4s ease-out;
                    }
                    aside[aria-label="Now playing view"] .fAte2d0xETy7pnDUAgHY, aside[aria-label="Now playing view"] .mdMUqcSHFw1lZIcYEblu {
                        background-color: rgba(var(--spice-rgb-main), 0.2) !important;
                        backdrop-filter: blur(24px) saturate(140%);
                        border-bottom: 1px solid rgba(var(--spice-rgb-selected-row),0.2);
                    }

                    aside[aria-label="Now playing view"]:has(.ZbDMGdU4aBOnrNLowNRq) .main-buddyFeed-scrollBarContainer:not(:has(.main-buddyFeed-content > .main-buddyFeed-header)), aside[aria-label="Now playing view"]:has(.W3E0IT3_STcazjTeyOJa) .cZCuJDjrGA2QMXja_Sua:not(:has(.AAdBM1nhG73supMfnYX7 > .fNXmHtlrj4UVWmhQrJ_5)) {
                        padding-top: 64px;
                    }

                    aside[aria-label="Now playing view"] {
                        --background-base: var(--spice-main) !important;
                    }

                    .main-nowPlayingView-gradient,
                    .IkRGajTjItEFQkRMeH6v.f2UE9n5nZcbgZrGYTU3r {
                        background: none !important;
                    }
                `;
        if (!document.getElementById("te-npv-ambience-style")) {
          document.head.appendChild(style);
        }

        this.initAmbience();
      },

      initAmbience() {
        const rightSidebar = document.querySelector(".Root__right-sidebar");
        if (!(Spicetify.Player.data && rightSidebar)) {
          setTimeout(() => this.initAmbience(), 10);
          return;
        }

        // Initialization
        const initialWidth = document.documentElement.style.getPropertyValue("--panel-width");
        document.documentElement.style.setProperty("--npv-ambience-width", `${Number.parseInt(initialWidth)}px`);
        document.documentElement.style.setProperty("--npv-ambience-img", `url(${Spicetify.Player.data.item.metadata.image_xlarge_url})`);

        const realWidth = rightSidebar.offsetWidth;
        if (realWidth !== 0) {
          setTimeout(() => {
            document.documentElement.style.setProperty("--npv-ambience-opacity", 1);
          }, 0);
        }

        // Observe Panel State
        new ResizeObserver(entries => {
          for (const entry of entries) {
            const width = entry.contentRect.width;
            document.documentElement.style.setProperty("--npv-ambience-opacity", width > 0 ? 1 : 0);
            if (width > 0) document.documentElement.style.setProperty("--npv-ambience-width", `${width}px`);
          }
        }).observe(rightSidebar);

        // Event Listeners
        Spicetify.Player.addEventListener("songchange", e => {
          const preloadImage = new Image();
          preloadImage.src = e.data.item.metadata.image_xlarge_url;
          preloadImage.onload = () => {
            document.documentElement.style.setProperty("--npv-ambience-img", `url(${preloadImage.src})`);
          };
        });
        console.log("[Theme Editor] NPVAmbience initialized");
      }
    },

    // ==========================================================================================
    // 🖥️ IMMERSIVE VIEW - Button to hide unnecessary information
    // ==========================================================================================
    ImmersiveView: {
      state: false,
      settings: {
        enableAtStartup: false,
        currentState: false,
        maintainStateOnRestart: false,
        hideControls: false,
        hideTopbar: true,
        hideLibrary: true,
        hideRightPanel: true,
        hidePlaybar: true
      },
      button: null,

      init() {
        if (
          !(
            Spicetify.CosmosAsync &&
            Spicetify.Platform.UpdateAPI &&
            Spicetify.React &&
            Spicetify.Topbar &&
            Spicetify.PopupModal &&
            document.getElementById("main") &&
            Spicetify.Keyboard
          )
        ) {
          setTimeout(() => this.init(), 10);
          return;
        }

        // Append Styling To Head
        const style = document.createElement("style");
        style.id = "te-immersive-view-style";
        style.textContent = `
                    #main.immersive-view-active.hideplaybar .Root__now-playing-bar {
                        display: none !important;
                    }

                    #main.immersive-view-active.hidelibrary .Root__nav-bar {
                        display: none !important;
                    }

                    #main.immersive-view-active.hidetopbar .Root__top-bar {
                        display: none !important;
                    }

                    #main.immersive-view-active.hiderightpanel .Root__right-sidebar {
                        display: none !important;
                    }

                    #main.immersive-view-active {
                        transition: grid-template-columns 0.3s ease, column-gap 0.3s ease, padding-bottom 0.3s ease;
                    }

                    .immersive-view-settings {
                        padding: 20px;
                        color: var(--spice-text);
                        display: flex;
                        flex-direction: column;
                        gap: 15px;
                        max-height: 400px;
                        overflow-y: auto;
                    }

                    .immersive-view-settings .setting-item {
                        display: grid;
                        grid-template-columns: 1fr auto;
                        align-items: center;
                        margin-bottom: 10px;
                    }

                    .immersive-view-settings .setting-item-special {
                        margin-top: 10px;
                        margin-bottom: 0px;
                    }

                    .immersive-view-settings .setting-item-special > span {
                        margin-inline-start: 10px;
                    }

                    .immersive-view-settings .setting-item-special > span ~ input {
                        width: 3em;
                        text-align: center;
                        background-color: var(--spice-highlight);
                        border-color: var(--spice-text);
                        margin-left: calc(100% - 21px);
                    }

                    .immersive-view-settings .setting-item span {
                        font-size: 16px;
                        line-height: 20px;
                    }

                    .immersive-view-settings button {
                        background: none;
                        border: none;
                        cursor: pointer;
                        padding: 0;
                        margin: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 20px;
                    }

                    .immersive-view-settings button svg {
                        width: 20px;
                        height: 20px;
                        fill: var(--spice-text);
                        transition: fill 0.3s ease;
                    }

                    .immersive-view-settings button.active svg {
                        fill: var(--spice-highlight);
                    }
                `;
        if (!document.getElementById("te-immersive-view-style")) {
          document.head.appendChild(style);
        }

        this.loadSettings();

        // Apply settings if enabled at startup
        if (this.settings.enableAtStartup || (this.settings.maintainStateOnRestart && this.settings.currentState)) {
          this.state = this.settings.currentState = true;
          this.updateClasses();
        }

        // Create the immersive view toggle button
        const buttonLabel = () => (this.state ? "Exit Immersive View" : "Enter Immersive View");
        const buttonIcon = () => (this.state ? "minimize" : "fullscreen");

        this.button = new Spicetify.Topbar.Button(
          buttonLabel(),
          buttonIcon(),
          () => {
            this.state = !this.state;
            this.button.label = buttonLabel();
            this.button.icon = buttonIcon();
            this.updateClasses();
          },
          false,
          true
        );

        this.button.tippy.setProps({
          placement: "bottom"
        });

        // Keyboard shortcut
        Spicetify.Keyboard.registerShortcut({ key: "i", ctrl: true }, () => {
          this.button.element.querySelector("button").click();
        });
        Spicetify.Keyboard.registerShortcut("esc", () => {
          if (this.state) {
            this.button.element.querySelector("button").click();
          }
        });

        // Config Modal trigger (Right click)
        this.button.element.oncontextmenu = event => {
          event.preventDefault();
          Spicetify.PopupModal.display({
            title: "Immersive View Settings",
            content: Spicetify.React.createElement(this.SettingsContent.bind(this))
          });
        };

        console.log("[Theme Editor] ImmersiveView initialized");
      },

      saveSettings() {
        localStorage.setItem("immersiveViewSettings", JSON.stringify(this.settings));
      },

      loadSettings() {
        const storedSettings = localStorage.getItem("immersiveViewSettings");
        if (storedSettings) {
          this.settings = { ...this.settings, ...JSON.parse(storedSettings) };
        }
      },

      updateClasses() {
        const mainElement = document.getElementById("main");
        if (!mainElement) return;
        this.settings.currentState = this.state;
        this.saveSettings();
        if (this.state) {
          mainElement.classList.add("immersive-view-active");
          Object.keys(this.settings).forEach(async key => {
            if (key.startsWith("hide")) {
              const className = key.toLowerCase();
              if (this.settings[key]) {
                mainElement.classList.add(className);
              } else {
                mainElement.classList.remove(className);
              }
            }

            if (key.includes("Controls")) {
              if (this.settings[key]) {
                const style = document.createElement("style");
                style.classList.add("immersive-view-controls");
                style.innerHTML = `
                                    html > body::after { display: none !important; }
                                    .Root__globalNav { padding-inline: 8px !important; padding-inline-end: 16px !important; }
                                    .Titlebar { display: none !important; }
                                `;
                document.head.appendChild(style);

                if (Spicetify.Platform.UpdateAPI._updateUiClient?.updateTitlebarHeight) {
                  Spicetify.Platform.UpdateAPI._updateUiClient.updateTitlebarHeight({
                    height: 1
                  });
                }

                if (Spicetify.Platform.UpdateAPI._updateUiClient?.setButtonsVisibility) {
                  Spicetify.Platform.UpdateAPI._updateUiClient.setButtonsVisibility(false);
                }

                window.addEventListener("beforeunload", () => {
                  if (Spicetify.Platform.UpdateAPI._updateUiClient?.setButtonsVisibility) {
                    Spicetify.Platform.UpdateAPI._updateUiClient.setButtonsVisibility(true);
                  }
                });

                await Spicetify.CosmosAsync.post("sp://messages/v1/container/control", {
                  type: "update_titlebar",
                  height: "1px"
                });

                const enforceHeight = () => {
                  Spicetify.CosmosAsync.post("sp://messages/v1/container/control", {
                    type: "update_titlebar",
                    height: "1px"
                  });
                };

                const intervalId = setInterval(enforceHeight, 100);
                setTimeout(() => {
                  clearInterval(intervalId);
                }, 10000);
              }
            }
          });
        } else {
          mainElement.classList.remove("immersive-view-active");
          Object.keys(this.settings).forEach(key => {
            if (key.startsWith("hide")) {
              const className = key.toLowerCase();
              mainElement.classList.remove(className);
            }
          });

          const styleElements = document.querySelectorAll(".immersive-view-controls");
          styleElements.forEach(styleElement => {
            styleElement.remove();
          });

          if (Spicetify.Platform.UpdateAPI._updateUiClient?.setButtonsVisibility) {
            Spicetify.Platform.UpdateAPI._updateUiClient.setButtonsVisibility({ showButtons: true });
          }

          if (Spicetify.Platform.UpdateAPI._updateUiClient?.updateTitlebarHeight) {
            Spicetify.Platform.UpdateAPI._updateUiClient.updateTitlebarHeight({
              height: this.settings.customHeight
            });
          }

          Spicetify.CosmosAsync.post("sp://messages/v1/container/control", {
            type: "update_titlebar",
            height: this.settings.customHeight
          });
        }
      },

      SettingsContent() {
        const self = this;
        const ToggleButton = ({ isActive, onClick }) => {
          return Spicetify.React.createElement(
            "button",
            {
              className: isActive ? "active" : "",
              onClick: e => {
                e.stopPropagation();
                onClick(e);
              }
            },
            Spicetify.React.createElement(
              "svg",
              { viewBox: "0 0 24 24" },
              Spicetify.React.createElement("rect", {
                x: 3,
                y: 3,
                width: 18,
                height: 18,
                rx: 4,
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2
              }),
              isActive &&
              Spicetify.React.createElement("path", {
                d: "M8 12l2 2 4-4",
                stroke: "currentColor",
                strokeWidth: 2,
                fill: "none"
              })
            )
          );
        };

        const TextBox = ({ value, onChange }) => {
          return Spicetify.React.createElement("input", {
            type: "text",
            value: value,
            onChange: e => onChange(e.target.value)
          });
        };

        const [localSettings, setLocalSettings] = Spicetify.React.useState({ ...self.settings });

        const toggleSetting = key => {
          const updatedSettings = { ...localSettings, [key]: !localSettings[key] };
          setLocalSettings(updatedSettings);
          self.settings[key] = updatedSettings[key];
          self.saveSettings();
          if (key === "enableAtStartup" || key === "maintainStateOnRestart") return;
          self.updateClasses();
        };

        return Spicetify.React.createElement(
          "div",
          { className: "immersive-view-settings" },
          ["enableAtStartup", "maintainStateOnRestart", "hideControls", "hideTopbar", "hideLibrary", "hideRightPanel", "hidePlaybar"].map(key => {
            const isHideControls = key === "hideControls";

            return Spicetify.React.createElement(
              "div",
              { className: "setting-item" },
              Spicetify.React.createElement(
                "span",
                null,
                key
                  .replace("hide", "Hide ")
                  .replace("enable", "Enable ")
                  .replace("maintain", "Maintain ")
                  .replace(/([A-Z])/g, " $1")
                  .trim()
              ),
              Spicetify.React.createElement(ToggleButton, {
                isActive: localSettings[key],
                onClick: () => toggleSetting(key)
              }),
              isHideControls &&
              localSettings["hideControls"] &&
              Spicetify.React.createElement(
                "div",
                { className: "setting-item setting-item-special" },
                Spicetify.React.createElement("span", null, "> Revert Height"),
                Spicetify.React.createElement(TextBox, {
                  value: self.settings.customHeight,
                  onChange: value => {
                    self.settings.customHeight = value;
                    self.updateClasses();
                  }
                })
              )
            );
          })
        );
      }
    }
  };

  // ==========================================================================================
  // 🚀 BOOTSTRAP (The Entry Point)
  // ==========================================================================================
  function init() {
    if (!Spicetify || !Spicetify.Player) { setTimeout(init, 300); return; }

    Config.load();
    Core.init();
    Core.applyConfig();
    UI.init();

    // Initialize Features
    Features.SongColor.init();
    Features.NextSong.init();
    Features.Rewind.init();
    Features.Adblock.init();
    Features.LoopyLoop.init();
    Features.ShufflePlus.init();
    Features.Scannables.init();
    Features.VolumePercentage.init();
    Features.NPVAmbience.init();
    Features.ImmersiveView.init();

    // Initialize Sync Session button in player bar
    createSyncButton();

    if (Config.get('autoPlayOnStart')) { setTimeout(() => { if (Spicetify.Player && !Spicetify.Player.isPlaying()) Spicetify.Player.play(); }, 2000); }
    // Ownership Notice
    if (Spicetify.Menu && Spicetify.Menu.Item) {
      new Spicetify.Menu.Item("Ownership: DizAAAr", false, () => {
        Spicetify.PopupModal.display({
          title: "Ownership Information",
          content: "This project is fully owned by DizAAAr.",
          isLarge: false,
        });
      }).register();
    }

    console.log(`[Theme Editor] Loaded Successfully (Refactored Version)`);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(init, 1000); }
  else { document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000)); }
})();