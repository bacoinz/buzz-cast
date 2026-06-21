const T = {
  en: {
    // Lobby
    subtitle:         "Choose your controller",
    status_connecting:"Connecting…",
    status_ready:     "Pick a free slot",
    status_lost:      "Connection lost — reconnecting…",
    player_slot:      n => `Player ${n}`,
    player_taken:     (n, name) => name || `Player ${n}`,
    instructions_btn: "Instructions",
    // Controller
    exit_btn:         "Exit",
    change_name_btn:  "Change name",
    // Prompts
    name_prompt:      "Your name:",
    default_name:     p => `Player ${p}`,
    join_failed:      r => `Could not join (${r}). Returning to menu.`,
  },
  pt: {
    subtitle:         "Escolhe o teu comando",
    status_connecting:"A ligar…",
    status_ready:     "Liga-te a um lugar livre",
    status_lost:      "Ligação perdida — a reconectar…",
    player_slot:      n => `Jogador ${n}`,
    player_taken:     (n, name) => name || `Jogador ${n}`,
    instructions_btn: "Instruções",
    exit_btn:         "Sair",
    change_name_btn:  "Alterar nome",
    name_prompt:      "O teu nome:",
    default_name:     p => `Jogador ${p}`,
    join_failed:      r => `Não foi possível entrar (${r}). A voltar ao menu.`,
  }
};

function getLang() {
  return localStorage.getItem("buzz_lang") || "en";
}

function setLang(lang) {
  localStorage.setItem("buzz_lang", lang);
  location.reload();
}

function t(key, ...args) {
  const lang = getLang();
  const val = (T[lang] && T[lang][key] !== undefined) ? T[lang][key] : T.en[key];
  return typeof val === "function" ? val(...args) : (val ?? key);
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (translated) el.textContent = translated;
  });
  const lang = getLang();
  document.querySelectorAll(".flag-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
}
