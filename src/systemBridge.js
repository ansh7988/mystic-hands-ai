/*
  MYSTIC HANDS AI
  Bridge to the local system helper (helper/mystic_helper.py).

  - Connects only when the user switches system control on.
  - Authenticates with the token the helper prints at start-up.
  - Sends commands only after the helper has accepted the token.
  - Reconnects automatically while control is enabled, but stops
    immediately if the token is rejected.
*/

export function createSystemBridge({
  url = 'ws://127.0.0.1:8765',
  onChange = () => {}
} = {}) {

  let ws = null;
  let token = '';
  let wantConnected = false;
  let authed = false;
  let retryTimer = null;
  let lastError = '';

  const state = { volume: null, muted: null, brightness: null };

  function status() {
    return {
      wantConnected,
      connected: !!ws && ws.readyState === 1,
      authed,
      error: lastError,
      state: { ...state }
    };
  }

  function emit() {
    onChange(status());
  }

  function open() {

    clearTimeout(retryTimer);

    try {
      ws = new WebSocket(url);
    } catch (error) {
      lastError = 'Could not open a connection to the helper';
      emit();
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', token }));
    };

    ws.onmessage = (event) => {

      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'welcome') {

        authed = true;
        lastError = '';
        Object.assign(state, message.state || {});

      } else if (message.type === 'state') {

        Object.assign(state, message.state || {});

      } else if (message.type === 'error') {

        lastError = message.message || 'Helper error';

        if (message.code === 'bad_token') {
          wantConnected = false;
        }
      }

      emit();
    };

    ws.onerror = () => {
      lastError = 'Helper not reachable. Is mystic_helper.py running?';
      emit();
    };

    ws.onclose = () => {

      authed = false;
      ws = null;

      emit();

      if (wantConnected) {
        retryTimer = setTimeout(open, 2000);
      }
    };
  }

  function connect(newToken) {

    token = newToken;
    wantConnected = true;
    lastError = '';

    if (!ws) open();

    emit();
  }

  function disconnect() {

    wantConnected = false;
    authed = false;

    clearTimeout(retryTimer);

    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }

    emit();
  }

  function send(command) {

    if (ws && ws.readyState === 1 && authed) {
      ws.send(JSON.stringify(command));
      return true;
    }

    return false;
  }

  function getState() {
    return state;
  }

  return { connect, disconnect, send, getState, status };
}