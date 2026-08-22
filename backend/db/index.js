const DRIVERS = {
  sqlite: () => require("./sqlite"),
  mysql: () => require("./mysql"),
  mongo: () => require("./mongo"),
  supabase: () => require("./supabase"),
  firebase: () => require("./firebase"),
};

let storePromise = null;

function getStore() {
  if (!storePromise) {
    const client = (process.env.DB_CLIENT || "sqlite").toLowerCase();
    const loader = DRIVERS[client];
    if (!loader) {
      throw new Error(`Unknown DB_CLIENT '${client}'. Supported: ${Object.keys(DRIVERS).join(", ")}`);
    }

    console.log(`[db] connecting to ${client}...`);
    const mod = loader();
    const init = typeof mod.init === "function" ? mod.init() : Promise.resolve(mod);

    storePromise = Promise.resolve(init)
      .then((store) => {
        console.log(`[db] connected: ${store.name}`);
        return store;
      })
      .catch((err) => {
        storePromise = null;
        throw err;
      });
  }
  return storePromise;
}

module.exports = { getStore };
