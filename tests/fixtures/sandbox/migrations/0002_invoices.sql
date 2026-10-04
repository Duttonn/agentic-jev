create table invoices (
  id text primary key,
  user_id text not null references users(id),
  cents integer not null,
  issued_at date not null,
  paid boolean not null default false
);
