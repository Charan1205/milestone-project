import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { z } from "zod";

const eventSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().min(3),
  type: z.enum(["Workshop", "Seminar", "Cultural"]),
  department: z.string().min(2),
  capacity: z.number().int().positive().optional(),
});

const registrationSchema = z.object({
  studentName: z.string().min(2),
  studentEmail: z.string().email(),
  studentId: z.string().min(5),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("campus_pulse.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    location TEXT NOT NULL,
    type TEXT NOT NULL,
    department TEXT NOT NULL,
    capacity INTEGER DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    student_email TEXT NOT NULL,
    student_id TEXT NOT NULL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    feedback TEXT,
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
  );
`);

// Seed Data
if (db.prepare("SELECT COUNT(*) as count FROM events").get().count === 0) {
  const seedEvents = [
    ['AI in Healthcare Seminar', 'Exploring modern AI applications in medical diagnosis and treatment.', '2026-05-15', 'Main Auditorium', 'Seminar', 'CS', 200],
    ['Robotics Hands-on Workshop', 'Build your first autonomous robot using Arduino and specialized sensors.', '2026-05-20', 'Lab 402', 'Workshop', 'Mechanical', 30],
    ['Digital Marketing Masterclass', 'Master SEO, social media algorithms, and content strategy.', '2026-05-25', 'Business Hall B', 'Workshop', 'Business', 50],
    ['Modern Art Exhibition', 'Showcasing student talent across photography, painting, and sculpture.', '2026-06-01', 'University Gallery', 'Cultural', 'Arts', 150],
    ['Cloud Computing Summit', 'AWS, Azure and GCP experts discuss the future of serverless architecture.', '2026-06-10', 'Tech Center', 'Seminar', 'CS', 100],
  ];
  const insert = db.prepare("INSERT INTO events (title, description, date, location, type, department, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)");
  seedEvents.forEach(e => insert.run(...e));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Middleware for Basic Auth for /api/admin/*
  const adminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = { login: 'admin', password: 'password123' }; // Simplified for the requirement
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === auth.login && password === auth.password) {
      return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Authentication required.');
  };

  // API Routes
  
  // Public Events API
  app.get("/api/events", (req, res) => {
    try {
      const { type, department, date } = req.query;
      let query = "SELECT * FROM events WHERE 1=1";
      const params: any[] = [];

      if (type) {
        query += " AND type = ?";
        params.push(type);
      }
      if (department) {
        query += " AND department = ?";
        params.push(department);
      }
      if (date) {
        query += " AND date = ?";
        params.push(date);
      }

      query += " ORDER BY date ASC";
      const events = db.prepare(query).all(...params);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.get("/api/events/:id", (req, res) => {
    try {
      const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch event" });
    }
  });

  // Registration API
  app.post("/api/events/:id/register", (req, res) => {
    try {
      const validated = registrationSchema.parse(req.body);
      const { studentName, studentEmail, studentId } = validated;
      const eventId = req.params.id;

      // Check capacity
      const event = db.prepare("SELECT capacity FROM events WHERE id = ?").get(eventId) as any;
      if (!event) return res.status(404).json({ error: "Event not found" });

      const count = db.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ?").get(eventId) as any;
      if (count.count >= event.capacity) {
        return res.status(400).json({ error: "Event is at full capacity" });
      }

      const info = db.prepare(
        "INSERT INTO registrations (event_id, student_name, student_email, student_id) VALUES (?, ?, ?, ?)"
      ).run(eventId, studentName, studentEmail, studentId);

      res.status(201).json({ id: info.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ error: "Failed to register" });
    }
  });

  // Admin CRUD API
  app.post("/api/admin/events", adminAuth, (req, res) => {
    try {
      const validated = eventSchema.parse(req.body);
      const { title, description, date, location, type, department, capacity } = validated;
      const info = db.prepare(
        "INSERT INTO events (title, description, date, location, type, department, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(title, description, date, location, type, department, capacity || 100);
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ error: "Failed to create event" });
    }
  });

  app.put("/api/admin/events/:id", adminAuth, (req, res) => {
    try {
      const { title, description, date, location, type, department, capacity } = req.body;
      db.prepare(
        "UPDATE events SET title = ?, description = ?, date = ?, location = ?, type = ?, department = ?, capacity = ? WHERE id = ?"
      ).run(title, description, date, location, type, department, capacity, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update event" });
    }
  });

  app.delete("/api/admin/events/:id", adminAuth, (req, res) => {
    try {
      db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete event" });
    }
  });

  // Stats API
  app.get("/api/admin/stats", adminAuth, (req, res) => {
    try {
      const totalEvents = db.prepare("SELECT COUNT(*) as count FROM events").get() as any;
      const totalRegistrations = db.prepare("SELECT COUNT(*) as count FROM registrations").get() as any;
      const registrationsByEvent = db.prepare(`
        SELECT e.title, COUNT(r.id) as registrations 
        FROM events e 
        LEFT JOIN registrations r ON e.id = r.event_id 
        GROUP BY e.id
      `).all();

      res.json({
        totalEvents: totalEvents.count,
        totalRegistrations: totalRegistrations.count,
        registrationsByEvent
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
