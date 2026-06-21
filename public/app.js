const params = new URLSearchParams(location.search);
const player = Number(params.get("player"));

const label = document.getElementById("label");
const conn = document.getElementById("conn");
const changeNameBtn = document.getElementById("change-name");

applyI18n();

let ws;
let ready = false;

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
}

function connect() {
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(wsProto + "//" + location.host);
  ws.onopen = () => {
    setConn(true);
    ws.send(JSON.stringify({ type: "join", player, name: getName() }));
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
    }
  };
  ws.onclose = () => {
    setConn(false);
    ready = false;
    setTimeout(connect, 1000);
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

function press(button, el) {
  if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "press", button }));
  if (navigator.vibrate) navigator.vibrate(30);
  el.classList.add("active");
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
