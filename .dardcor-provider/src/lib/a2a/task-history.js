const STORE_KEY = "__miawrouterA2aTasks";
const DEFAULT_MAX_TASKS = 100;

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = { tasks: [], maxTasks: DEFAULT_MAX_TASKS };
  return globalThis[STORE_KEY];
}

export function recordA2ATask(task) {
  const history = store();
  const existing = history.tasks.find((item) => item.id === task.id);
  const record = {
    id: task.id,
    name: task.name || task.skillId || "unknown",
    skillId: task.skillId || null,
    status: task.status || "submitted",
    createdAt: task.createdAt || existing?.createdAt || Date.now(),
    completedAt: task.completedAt ?? existing?.completedAt ?? null,
    error: task.error ?? existing?.error ?? null,
  };

  if (existing) Object.assign(existing, record);
  else history.tasks.push(record);
  while (history.tasks.length > history.maxTasks) history.tasks.shift();
  return record;
}

export function getRecentA2ATasks() {
  return [...store().tasks].reverse();
}
