export interface User {
  id: string;
  email: string;
  password: string;
  plan: "free" | "team" | "enterprise";
}

/** In memory table. The migration in migrations/0001_users.sql is the real shape. */
const USERS: User[] = [
  { id: "u_1", email: "dana@example.com", password: "hunter2", plan: "team" },
  { id: "u_2", email: "sam@example.com", password: "letmein", plan: "free" },
];

export function findUserByEmail(email: string): User | undefined {
  return USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function findUserById(id: string): User | undefined {
  return USERS.find((u) => u.id === id);
}
