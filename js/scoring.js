// ═══════════════════════════════════════════════════════
// Easy 3D Print — Project Scoring Engine
//
// Model (as in "Друкар" project):
//   Owner      → 70% of project score
//   Helpers    → 30%, split equally among them
//
// Score sources:
//   - Task completion ratio (sprint tasks done/total)
//   - Deadline status (on-track / at-risk / overdue)
//   - KPI progress (0–100%, where applicable)
//   - Sprint velocity (tasks completed per sprint)
// ═══════════════════════════════════════════════════════

window.E3D_SCORING = {

  cfg: window.E3D_STATIC?.scoring || { owner_weight:0.70, helper_weight:0.30 },

  // ── SCORE ONE PROJECT ─────────────────────────────────
  // tasks: array of task objects for this project
  // progress: 0-100 explicit override (optional)
  scoreProject(project, tasks=[], progressOverride=null) {
    const now = new Date();
    const start    = project.start    ? new Date(project.start)    : now;
    const deadline = project.deadline ? new Date(project.deadline) : now;

    // — Timeline progress (how far through the project are we?)
    const totalDays   = Math.max(1, (deadline - start) / 86400000);
    const elapsedDays = Math.max(0, (now - start) / 86400000);
    const timeProgress = Math.min(1, elapsedDays / totalDays); // 0→1

    // — Task completion ratio
    const doneTasks  = tasks.filter(t => this._isDone(t.status)).length;
    const totalTasks = tasks.length;
    const taskRatio  = totalTasks > 0 ? doneTasks / totalTasks : null;

    // — Composite score (0-100)
    let score;
    if (progressOverride !== null) {
      score = Math.min(100, Math.max(0, progressOverride));
    } else if (taskRatio !== null) {
      // blend: 60% task completion + 40% time-based estimate
      score = Math.round((taskRatio * 0.6 + timeProgress * 0.4) * 100);
    } else {
      // no tasks: use time progress as estimate (TBD data)
      score = Math.round(timeProgress * 100);
    }

    // — Deadline health
    const daysLeft  = Math.round((deadline - now) / 86400000);
    const daysTotal = Math.round(totalDays);
    let health;
    if (daysLeft < 0)                        health = 'overdue';
    else if (daysLeft < daysTotal * 0.15)    health = 'at-risk';
    else                                     health = 'on-track';

    return {
      project_id:    project.id,
      score,           // 0-100
      taskRatio,       // null if no tasks
      doneTasks,
      totalTasks,
      timeProgress:  Math.round(timeProgress * 100),
      daysLeft,
      health,          // 'on-track' | 'at-risk' | 'overdue'
      isVacancy:     (project.owner || '').includes('Вакансія'),
    };
  },

  // ── PERSON SCORES ─────────────────────────────────────
  // Returns map: personName → { total_score, owned, helped, details }
  calcPersonScores(projects, projectScores) {
    const people = {};

    projects.forEach(p => {
      const ps = projectScores.find(s => s.project_id === p.id);
      const score = ps ? ps.score : 0;

      // Owner gets 70%
      const ownerName = p.owner || 'Вакансія';
      if (!people[ownerName]) people[ownerName] = { owned:[], helped:[], total:0 };
      const ownerPoints = score * this.cfg.owner_weight;
      people[ownerName].owned.push({ project_id:p.id, name:p.name, points:ownerPoints, score });
      people[ownerName].total += ownerPoints;

      // Helpers split 30%
      const helpers = p.helpers || [];
      if (helpers.length > 0) {
        const perHelper = (score * this.cfg.helper_weight) / helpers.length;
        helpers.forEach(h => {
          if (!people[h]) people[h] = { owned:[], helped:[], total:0 };
          people[h].helped.push({ project_id:p.id, name:p.name, points:perHelper, score });
          people[h].total += perHelper;
        });
      }
    });

    // Normalize to 0-100 across all people
    const maxTotal = Math.max(...Object.values(people).map(p=>p.total), 1);
    Object.keys(people).forEach(name => {
      people[name].normalized = Math.round(people[name].total / maxTotal * 100);
    });

    return people;
  },

  // ── SPRINT STATS ──────────────────────────────────────
  sprintStats(tasks) {
    const byProject = {};
    tasks.forEach(t => {
      const key = t.project_id || t.project || 'other';
      if (!byProject[key]) byProject[key] = { done:0, total:0, tasks:[] };
      byProject[key].total++;
      if (this._isDone(t.status)) byProject[key].done++;
      byProject[key].tasks.push(t);
    });

    const total = tasks.length;
    const done  = tasks.filter(t => this._isDone(t.status)).length;
    const overdue = tasks.filter(t => {
      if (!t.deadline) return false;
      return new Date(t.deadline) < new Date() && !this._isDone(t.status);
    }).length;

    return { total, done, overdue, completion: total ? Math.round(done/total*100) : 0, byProject };
  },

  // ── HELPERS ───────────────────────────────────────────
  _isDone(status='') {
    const s = status.toLowerCase();
    return s.includes('виконано') || s.includes('done') || s.includes('ready') || s.includes('вирішено');
  },

  _statusLabel(health) {
    return { 'on-track':'В графіку', 'at-risk':'Під ризиком', 'overdue':'Прострочено' }[health] || health;
  },

  _healthColor(health) {
    return { 'on-track':'#3CB648', 'at-risk':'#c07820', 'overdue':'#d94040' }[health] || '#7a9a7a';
  },
};
