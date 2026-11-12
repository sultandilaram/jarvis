import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Entry,
  Task,
  Memory,
  Settings,
  VoiceEvent,
} from "../shared/types.ts";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,threadId TEXT,turnId TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,taskId TEXT,role TEXT NOT NULL,text TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_events(id INTEGER PRIMARY KEY,sessionId TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,text TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('confirmed','inferred')));`);
    if (
      !(this.db.prepare("PRAGMA table_info(memories)").all() as any[]).some(
        (c) => c.name === "scope",
      )
    )
      this.db.exec(
        "ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'",
      );
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  recall(query: string, scope = "global") {
    const words = [
      ...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []),
    ].slice(0, 30);
    return this.memories()
      .filter(
        (m) =>
          scope === "all" ||
          !m.scope ||
          m.scope === "global" ||
          m.scope === scope,
      )
      .map((m) => ({
        m,
        score:
          words.reduce(
            (n, w) => n + (m.text.toLowerCase().includes(w) ? 1 : 0),
            0,
          ) + (m.kind === "confirmed" ? 0.1 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.m);
  }
  recover() {
    this.db
      .prepare(
        "UPDATE tasks SET status='interrupted' WHERE status IN ('working','approval','stopping')",
      )
      .run();
  }
  tasks(): Task[] {
    return this.db
      .prepare("SELECT * FROM tasks ORDER BY createdAt DESC LIMIT 100")
      .all() as Task[];
  }
  entries(): Entry[] {
    return this.db
      .prepare(
        "SELECT * FROM (SELECT rowid,* FROM entries ORDER BY rowid DESC LIMIT 1000) ORDER BY rowid",
      )
      .all() as Entry[];
  }
  task(title: string, threadId: string | null): Task {
    const t: Task = {
      id: randomUUID(),
      title: title.slice(0, 160),
      status: "working",
      threadId,
      turnId: null,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?)")
      .run(t.id, t.title, t.status, t.threadId, t.turnId, t.createdAt);
    return t;
  }
  updateTask(
    id: string,
    patch: Partial<Pick<Task, "status" | "threadId" | "turnId">>,
  ) {
    for (const key of ["status", "threadId", "turnId"] as const)
      if (patch[key] !== undefined)
        this.db
          .prepare(`UPDATE tasks SET ${key}=? WHERE id=?`)
          .run(patch[key]!, id);
  }
  entry(
    role: Entry["role"],
    text: string,
    taskId: string | null = null,
    id: string = randomUUID(),
  ) {
    this.db
      .prepare(
        "INSERT INTO entries VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text",
      )
      .run(id, taskId, role, text, new Date().toISOString());
    return id;
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO kv VALUES(?,?)")
      .run(key, JSON.stringify(value));
  }
  settings(): Settings {
    return {
      keepAvailable: false,
      routineChecks: false,
      speakReplies: false,
      voiceProvider: "live",
      voiceModel: "gpt-live-1",
      voiceName: "vesper",
      wakeWordEnabled: false,
      startAtLogin: false,
      voiceIdleSeconds: 20,
      ...this.get("settings", {}),
    };
  }
  memories(): Memory[] {
    return this.db.prepare("SELECT * FROM memories").all() as Memory[];
  }
  remember(text: string, kind: Memory["kind"], scope = "global") {
    this.db
      .prepare("INSERT INTO memories(id,text,kind,scope) VALUES(?,?,?,?)")
      .run(randomUUID(), text, kind, scope);
  }
  forget(id: string) {
    this.db.prepare("DELETE FROM memories WHERE id=?").run(id);
  }
  voiceEvent(event: VoiceEvent) {
    this.db
      .prepare(
        "INSERT INTO voice_events(sessionId,kind,detail,createdAt) VALUES(?,?,?,?)",
      )
      .run(event.sessionId, event.kind, event.detail, event.createdAt);
    this.db
      .prepare(
        "DELETE FROM voice_events WHERE id < (SELECT MAX(id)-2000 FROM voice_events)",
      )
      .run();
  }
  voiceDiagnostics(): VoiceEvent[] {
    return this.db
      .prepare(
        "SELECT sessionId,kind,detail,createdAt FROM (SELECT * FROM voice_events ORDER BY id DESC LIMIT 300) ORDER BY id",
      )
      .all() as VoiceEvent[];
  }
  close() {
    this.db.close();
  }
}
