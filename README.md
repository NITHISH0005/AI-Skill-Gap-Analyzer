# AI Skill Gap Analyzer

A Next.js app to analyze resumes and interviews, highlighting skill gaps and providing interview practice.

## Features
- Resume upload and automated skill analysis
- Interview practice module
- Dashboard with analysis history and export

## Requirements
- Node.js 18+ or compatible
- pnpm or npm

## Setup
1. Clone the repository

   git clone https://github.com/NITHISH0005/AI-Skill-Gap-Analyzer.git
   cd "AI Skill Gap Analyzer"

2. Install dependencies

   pnpm install
   # or
   npm install

3. Environment

Create a `.env` file (example values depend on your Supabase project):

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

4. Run the app

   pnpm dev
   # or
   npm run dev

5. Build for production

   pnpm build
   pnpm start

## Scripts
- `dev` - Run the development server
- `build` - Create a production build
- `start` - Start the production server

## Database
SQL migrations are provided in the `scripts/` folder: `001_create_tables.sql` and `002_update_schema.sql`.

## Contributing
Feel free to open issues and pull requests.

## License
MIT

## Author
Nithish Kumar — nithishkumar3989@gmail.com
