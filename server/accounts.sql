-- Accounts and cloud saves (server/accounts.js). Better Auth's tables as its migration generates them for the
-- anonymous + bearer plugins (better-auth 1.7.7), then our own saves and link codes. Apply with:
--   npx wrangler d1 execute wingnut-circus --remote --file=server/accounts.sql
create table if not exists "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);
create table if not exists "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table if not exists "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table if not exists "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index if not exists "session_userId_idx" on "session" ("userId");
create index if not exists "account_userId_idx" on "account" ("userId");
create index if not exists "verification_identifier_idx" on "verification" ("identifier");
-- one save per account; rev guards against an older device overwriting a newer save, t is when the game last saved it
create table if not exists saves (user_id text not null primary key references "user" ("id") on delete cascade, data text not null, rev integer not null, t integer not null, updated_at text not null);
-- short-lived single-use codes that sign a second device into an account
create table if not exists link_codes (code text not null primary key, user_id text not null references "user" ("id") on delete cascade, expires integer not null);
-- rate limits kept in the database (memory counters do not work across Workers instances): Better Auth's own table,
-- and link-code attempts per client address and minute
create table if not exists "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
create table if not exists link_tries (ip text not null, minute integer not null, n integer not null, primary key (ip, minute));
