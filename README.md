# BuzzController

Comandos **Buzz!** virtuais no telemóvel para o **PCSX2**. Cada jogador abre o
browser, escolhe um lugar e carrega nos botões (vermelho grande + azul, laranja,
verde, amarelo) — tal como na campainha física. Suporta **8 jogadores**.

A app corre no PC, serve uma webapp na rede local e emula um **teclado**. O PCSX2
não distingue isto de um teclado real: basta mapear cada Pad Buzz às teclas abaixo.

> ⚠️ **A janela do PCSX2 tem de estar EM FOCO** para receber as teclas.

---

## Como funciona

```
Telemóvel (browser) ──WebSocket/WiFi──► App no PC ──emula teclado──► PCSX2
```

## Pré-requisitos

- [Node.js](https://nodejs.org) instalado no PC.
- Telemóveis e PC na **mesma rede WiFi**.
- A firewall do Windows tem de permitir a porta **3000** (na 1ª vez o Windows
  pergunta — autoriza em "Redes privadas").

## Arrancar

```sh
npm install
npm start
```

O terminal mostra um **QR code** e o endereço (ex.: `http://192.168.1.50:3000`).
Cada jogador aponta a câmara do telemóvel ao QR, escolhe um lugar livre e está
pronto. No PC podes testar em `http://localhost:3000`.

## Mapeamento de teclas (copiar para o PCSX2)

Definido em [`config.js`](config.js). 8 jogadores × 5 botões = 40 teclas únicas.

| Jogador | Buzzer (vermelho) | Azul | Laranja | Verde | Amarelo |
|--------:|:-----------------:|:----:|:-------:|:-----:|:-------:|
| 1 | Q | W | E | R | T |
| 2 | A | S | D | F | G |
| 3 | Z | X | C | V | B |
| 4 | Y | U | I | O | P |
| 5 | H | J | K | L | N |
| 6 | Num1 | Num2 | Num3 | Num4 | Num5 |
| 7 | Num6 | Num7 | Num8 | Num9 | Num0 |
| 8 | F | M | , | . | / |

`Num1`–`Num0` = teclas do **teclado numérico** (numpad).

## Configurar o PCSX2

1. Abre **Settings → Controllers**.
2. Para **8 jogadores** precisas de **2 dispositivos Buzz** (cada um dá 4 comandos):
   adiciona/atribui dois *Buzz Controllers* aos portos USB.
3. Para cada Pad (1 a 8), mapeia os botões **buzzer / azul / laranja / verde /
   amarelo** às teclas da tabela acima.
4. Guarda. Põe o jogo Buzz a correr com a janela do PCSX2 em foco e testa.

## Resolução de problemas

- **Os botões não fazem nada no jogo:** a janela do PCSX2 não está em foco, ou o
  mapeamento no PCSX2 não corresponde à tabela.
- **O telemóvel não abre a página:** confirma que está na mesma WiFi e que a
  firewall permite a porta 3000.
- **`npm install` falha no nut.js:** podem faltar ferramentas de build nativas do
  Windows; reinstala o Node com a opção de *Tools for Native Modules* ativada.
