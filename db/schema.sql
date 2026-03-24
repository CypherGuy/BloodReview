-- BloodReview database schema
-- Run once: mysql -u root -p < db/schema.sql

CREATE DATABASE  bloodreview;
USE bloodreview;

-- ── Users ─────────────────────────────────────────────────────────────────────

CREATE TABLE  logins (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(50)  NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── User profiles ─────────────────────────────────────────────────────────────

CREATE TABLE  user_profiles (
  user_id            INT          PRIMARY KEY,
  display_name       VARCHAR(100),
  age                INT,
  sex                ENUM('Male','Female','Other','Prefer not to say'),
  exercise_frequency VARCHAR(100),
  medications        TEXT,
  notes              TEXT,
  -- Privacy flags: controls what context the AI is allowed to see
  ai_can_see_age        TINYINT(1) DEFAULT 1,
  ai_can_see_sex        TINYINT(1) DEFAULT 1,
  ai_can_see_exercise   TINYINT(1) DEFAULT 1,
  ai_can_see_medications TINYINT(1) DEFAULT 0,
  overview_analysis  TEXT,                  -- cached AI overview; cleared when a new test is added
  updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES logins(id) ON DELETE CASCADE
);

-- ── Blood tests ───────────────────────────────────────────────────────────────

CREATE TABLE  blood_tests (
  id              INT          AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  test_date       DATE         NOT NULL,
  source_file_key VARCHAR(500),          -- S3 object key
  analysis        TEXT,                  -- cached AI analysis text
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES logins(id) ON DELETE CASCADE
);

ALTER TABLE blood_tests ADD INDEX  idx_user_date (user_id, test_date);

-- ── Blood markers ─────────────────────────────────────────────────────────────

CREATE TABLE  blood_markers (
  id              INT           AUTO_INCREMENT PRIMARY KEY,
  test_id         INT           NOT NULL,
  marker_name     VARCHAR(100)  NOT NULL,
  value           DECIMAL(10,3) NOT NULL,
  unit            VARCHAR(30),
  reference_low   DECIMAL(10,3),
  reference_high  DECIMAL(10,3),
  FOREIGN KEY (test_id) REFERENCES blood_tests(id) ON DELETE CASCADE
);

ALTER TABLE blood_markers ADD INDEX  idx_test_id (test_id);
