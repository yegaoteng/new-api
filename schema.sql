-- 不知名社区 · D1 建表脚本
-- 部署时执行：wrangler d1 execute bzm-db --remote --file=./schema.sql
-- 本地执行：  wrangler d1 execute bzm-db --local  --file=./schema.sql

DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS post_likes;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS mods;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  username       TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL DEFAULT '',
  password_hash  TEXT,                       -- Prism 用户为空（随机哈希占位）
  bio            TEXT NOT NULL DEFAULT '',
  avatar         TEXT NOT NULL DEFAULT '',
  prism_sub      TEXT,
  role           TEXT NOT NULL DEFAULT 'user',   -- user | admin
  status         TEXT NOT NULL DEFAULT 'active', -- active | banned
  token_version  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);
CREATE INDEX idx_users_created ON users(created_at DESC);

CREATE TABLE posts (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  format         TEXT NOT NULL DEFAULT 'plain',  -- plain | markdown
  images         TEXT NOT NULL DEFAULT '[]',    -- JSON 数组，存代理 URL
  views          INTEGER NOT NULL DEFAULT 0,
  likes          INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'normal', -- normal | hidden
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_posts_feed   ON posts(status, created_at DESC);
CREATE INDEX idx_posts_hot    ON posts(status, views DESC, likes DESC);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);

CREATE TABLE post_likes (
  post_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_likes_user ON post_likes(user_id, created_at DESC);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'normal',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at ASC, id ASC);

CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,               -- post | comment | mod
  target_id    TEXT NOT NULL,
  reporter_id  TEXT NOT NULL,
  reason       TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  created_at   INTEGER NOT NULL,
  UNIQUE (target_type, target_id, reporter_id)
);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE mods (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  image       TEXT NOT NULL DEFAULT '',
  versions    TEXT NOT NULL DEFAULT '[]',   -- JSON 数组，如 ["1.21.1","1.20.4"]
  loaders     TEXT NOT NULL DEFAULT '[]',   -- JSON 数组，如 ["Forge","Fabric"]
  views       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'normal',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_mods_feed   ON mods(status, created_at DESC);
CREATE INDEX idx_mods_author ON mods(author_id, created_at DESC);
