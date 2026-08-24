# Verificador de Chassi — App Desktop

Janela nativa que carrega o site publicado no Netlify, com opção de manter a janela sempre visível por cima de outras.

## Rodar em modo desenvolvimento

```
cd desktop-app
npm install
npm start
```

## Sempre visível (por cima de tudo)

- Menu **Janela → Sempre visível (por cima de tudo)**, ou
- Atalho `Ctrl+Shift+T` (funciona mesmo com a janela sem foco)

## Gerar instalador Windows (.exe)

```
npm run dist
```

O instalador fica em `dist/`.

## Trocar a URL do site

Edite `URL_SITE` em [main.js](main.js).
