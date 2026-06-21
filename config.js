// config.js — Fonte de verdade do mapeamento jogador -> botao -> tecla.
//
// Estas sao as teclas que o servidor vai "carregar" no teclado quando um
// telemovel toca num botao. Copia esta tabela para o PCSX2 ao mapear cada Pad.
//
// Botoes de cada comando Buzz: buzzer (vermelho grande) + azul, laranja, verde, amarelo.
// 8 jogadores x 5 botoes = 40 teclas unicas. Evitam-se teclas usadas por hotkeys
// comuns do PCSX2 (F1-F12, Tab, Space, Esc, etc.).
//
// Os nomes ("Q", "W"...) tem de corresponder a chaves do enum `Key` do nut.js.

const PORT = 3000;

// player (1-8) -> { buzzer, blue, orange, green, yellow } : nome da tecla nut.js
const KEYMAP = {
  1: { buzzer: "Q", blue: "W", orange: "E", green: "R", yellow: "T" },
  2: { buzzer: "A", blue: "S", orange: "D", green: "F", yellow: "G" },
  3: { buzzer: "Z", blue: "X", orange: "C", green: "V", yellow: "B" },
  4: { buzzer: "Y", blue: "U", orange: "I", green: "O", yellow: "P" },
  5: { buzzer: "H", blue: "J", orange: "K", green: "L", yellow: "N" },
  6: { buzzer: "Num1", blue: "Num2", orange: "Num3", green: "Num4", yellow: "Num5" },
  7: { buzzer: "Num6", blue: "Num7", orange: "Num8", green: "Num9", yellow: "Num0" },
  8: { buzzer: "F", blue: "M", orange: "Comma", green: "Period", yellow: "Slash" },
};

const PLAYERS = 8;
const BUTTONS = ["buzzer", "blue", "orange", "green", "yellow"];

module.exports = { PORT, KEYMAP, PLAYERS, BUTTONS };
