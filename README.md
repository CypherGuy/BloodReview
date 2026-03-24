# BloodReview

Track, analyse and evaluate your blood test results over time. Upload CSVs, view trends with charts, and get AI-powered analysis.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
# then fill in the values
```

| Variable                | Description                           |
| ----------------------- | ------------------------------------- |
| `SESSION_SECRET`        | Any long random string                |
| `DB_HOST`               | MySQL host (default: localhost)       |
| `DB_USER`               | MySQL user                            |
| `DB_PASSWORD`           | MySQL password                        |
| `DB_NAME`               | Database name (default: bloodreview)  |
| `AWS_ACCESS_KEY_ID`     | IAM user with S3 PutObject permission |
| `AWS_SECRET_ACCESS_KEY` | IAM secret                            |
| `AWS_REGION`            | e.g. eu-west-2                        |
| `S3_BUCKET_NAME`        | Your S3 bucket name                   |
| `ANTHROPIC_API_KEY`     | From console.anthropic.com            |

### 3. Set up the database

```bash
mysql -u root -p < db/schema.sql
```

### 4. Run

```bash
npm start        # production
npm run dev      # with auto-reload (nodemon)
```

Visit `http://localhost:5500`

---

## CSV upload format

Each blood test is uploaded as a CSV with these exact column headers:

```
marker_name, value, unit, reference_low, reference_high
```

See `sample-test.csv` for a working example.

---

## AWS setup (minimal)

1. Create an S3 bucket (private, block all public access)
2. Create an IAM user → attach an inline policy:

```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
}
```

3. Generate access keys for that user and add to `.env`

---

## AI analysis

Uses [Claude Haiku](https://console.anthropic.com) — the cheapest model, typically <$0.01 per analysis. Results are cached per test so you won't be charged twice for the same test.

Privacy controls on the Profile page let you choose what context (age, sex, exercise, medications) the AI is allowed to see.

Disclaimer: This project isn't intended for medical advice. Also this was significantly vibe coded with the intention of trying out some new claude skills related to frontend design and security. However the project itself is fully functional.
