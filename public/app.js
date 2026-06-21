const params = new URLSearchParams(location.search);
const player = Number(params.get("player"));

const label = document.getElementById("label");
const conn = document.getElementById("conn");
const pingEl = document.getElementById("ping");
const changeNameBtn = document.getElementById("change-name");

applyI18n();

let ws;
let ready = false;
let backoff = 1000;
let pingTimer = null;

function getName() {
  return localStorage.getItem("buzz_name") || "";
}

function askName(force) {
  const current = getName();
  if (!force && current) return current;
  const input = prompt(t("name_prompt"), current) ?? current;
  const trimmed = input.trim().slice(0, 20);
  const final = trimmed || current || t("default_name", player);
  localStorage.setItem("buzz_name", final);
  return final;
}

function updateLabel() {
  const name = getName() || t("default_name", player);
  label.textContent = name;
}

function setConn(ok) {
  conn.classList.toggle("on", ok);
  conn.title = ok ? "Connected" : "Disconnected";
  if (!ok) pingEl.textContent = "";
}

function setPing(rtt) {
  pingEl.textContent = rtt + "ms";
  pingEl.style.color = rtt < 80 ? "rgba(120,230,140,0.6)"
                     : rtt < 200 ? "rgba(255,210,80,0.6)"
                                 : "rgba(255,100,100,0.7)";
}

function startPinging() {
  stopPinging();
  const send = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
    }
  };
  send();
  pingTimer = setInterval(send, 2000);
}

function stopPinging() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function connect() {
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(wsProto + "//" + location.host);
  ws.onopen = () => {
    setConn(true);
    backoff = 1000;
    ws.send(JSON.stringify({ type: "join", player, name: getName() }));
    startPinging();
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "join_result") {
      if (msg.ok) {
        ready = true;
      } else {
        alert(t("join_failed", msg.reason));
        location.href = "index.html";
      }
    } else if (msg.type === "pong") {
      const rtt = Date.now() - msg.t;
      setPing(rtt);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "latency", rtt }));
    }
  };
  ws.onclose = () => {
    setConn(false);
    ready = false;
    stopPinging();
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10000);
  };
}

askName(false);
updateLabel();
connect();

changeNameBtn.addEventListener("click", () => {
  askName(true);
  updateLabel();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "join", player, name: getName() }));
  }
});

// Buzzer feedback: visual flash on press.
function buzzerFeedback(el) {
  el.classList.remove("flash");
  void el.offsetWidth; // restart animation
  el.classList.add("flash");
}

function press(button, el) {
  if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "press", button }));
  el.classList.add("active");
  if (button === "buzzer") buzzerFeedback(el);
}

function release(el) {
  el.classList.remove("active");
}

document.querySelectorAll("[data-button]").forEach((el) => {
  const btn = el.dataset.button;
  const onDown = (e) => { e.preventDefault(); press(btn, el); };
  const onUp = (e) => { e.preventDefault(); release(el); };
  el.addEventListener("touchstart", onDown, { passive: false });
  el.addEventListener("touchend", onUp, { passive: false });
  el.addEventListener("touchcancel", onUp, { passive: false });
  el.addEventListener("mousedown", onDown);
  el.addEventListener("mouseup", onUp);
  el.addEventListener("mouseleave", onUp);
});

window.addEventListener("pagehide", () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "leave" }));
});
