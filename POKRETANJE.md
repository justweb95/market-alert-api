# Pokretanje backend-a (fb-alert-api)

1. **Pokreni WSL**
   - Otvori terminal i uđi u WSL (Ubuntu ili tvoja distribucija)

2. **Proveri da li su baze pokrenute**
   - PostgreSQL:
     ```bash
     ps aux | grep postgres
     ```
   - Redis:
     ```bash
     ps aux | grep redis
     ```
   - Ako nisu pokrenuti, startuj ih:
     ```bash
     sudo service postgresql start
     sudo service redis-server start
     ```

3. **Vrati se u Windows terminal** (ili ostani u WSL ako koristiš Node iz WSL-a)

4. **Migriraj baze (ako treba)**
   ```bash
   npx prisma db push
   ```

5. **Pokreni backend**
   ```bash
   npm run dev
   ```

---

- API će biti dostupan na: http://localhost:3000
- Ako imaš problem sa konekcijom na baze, proveri da li su servisi pokrenuti u WSL-u.
- Sve konfiguracije su već podešene u projektu.
