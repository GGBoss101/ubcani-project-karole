// Firefox (Manifest V2) has no way to run a content script inside the page itself, which
// youtube-main.js needs for YouTube's player controls. This adds it to the page as a <script>.
const script = document.createElement("script");
script.src = browser.runtime.getURL("youtube-main.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);
