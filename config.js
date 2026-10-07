// ====== Everything you'd want to customize lives here ======
module.exports = {
  // Name shown in menus and the window
  NAME: "Dontuse Browser",

  // %s is replaced with what the user types in the address bar
  SEARCH_URL: "https://www.google.com/search?q=%s",

  // Colors for the browser's own interface
  THEME: {
    bg: "#16181d",     // window / tab strip background
    bar: "#22252c",    // toolbar and active tab
    tab: "#2c3039",    // inactive tabs
    accent: "#7c5cff", // highlights
    text: "#e8eaed",
  },

  // Bookmarks shown on first launch (users can add/remove with the star button)
  DEFAULT_BOOKMARKS: [
    { title: "YouTube", url: "https://www.youtube.com" },
    { title: "Google", url: "https://www.google.com" },
    { title: "Wikipedia", url: "https://www.wikipedia.org" },
    { title: "GitHub", url: "https://github.com" },
  ],
};
