export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Neon Postgres (London) migration target. When set, the app connects here instead of
  // DATABASE_URL. At cutover this can be removed and DATABASE_URL pointed at Neon directly.
  databaseUrlNeon: process.env.DATABASE_URL_NEON ?? "",
  autodataDroneSecret: process.env.AUTODATA_DRONE_SECRET ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
};
