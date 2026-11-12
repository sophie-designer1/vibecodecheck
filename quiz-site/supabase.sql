-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run (한 번만)
create table if not exists quizzes (
  id          text primary key,
  host_key    text not null,
  title       text not null,
  type        text not null check (type in ('quiz','survey')),
  status      text not null default 'lobby' check (status in ('lobby','running','closed')),
  questions   jsonb not null,
  created_at  bigint not null,
  started_at  bigint
);

create table if not exists entries (
  token       text primary key,
  quiz_id     text not null references quizzes(id) on delete cascade,
  name        text not null,
  name_key    text not null,
  started_at  bigint,
  done        boolean not null default false,
  answers     jsonb not null default '[]',
  score       int not null default 0,
  ms          int not null default 0,
  created_at  bigint not null,
  unique (quiz_id, name_key)
);
create index if not exists entries_quiz_idx on entries (quiz_id, created_at);

-- 브라우저에서 직접 접근 못 하게 RLS 켜기 (서버의 service_role 키만 접근)
alter table quizzes enable row level security;
alter table entries enable row level security;
