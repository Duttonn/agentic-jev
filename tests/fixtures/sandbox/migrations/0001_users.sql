create table users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  plan text not null default 'free'
);
