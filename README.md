## Deployment Application

 ```bash
http://34.128.123.217/
```

## Getting Started for Local Testing 

### 1. Clone the repo

```bash
git clone https://github.com/AdityaNugraha1/sp_fs_adit.git
cd "sp_fs_adit"
```

### 2. Start Backend

```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run dev
```
Backend runs at http://localhost:4000

### 3. Start Frontend

```bash
cd ../frontend
npm install
npm run dev
```
Frontend runs at http://localhost:3000

### Good luck!
