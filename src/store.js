import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Almacén de reservas en un fichero JSON. Suficiente para una demo de un solo
// proceso; para producción conviene sustituirlo por una base de datos.
export class BookingStore {
  constructor(file) {
    this.file = file;
    try {
      this.bookings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.bookings = [];
    }
  }

  all() {
    return this.bookings;
  }

  add(booking) {
    this.bookings.push(booking);
    this.#save();
    return booking;
  }

  cancel(code, email) {
    const b = this.bookings.find(
      (x) => x.code === code && x.email.toLowerCase() === String(email).toLowerCase() && x.status === 'confirmada',
    );
    if (!b) return null;
    b.status = 'cancelada';
    this.#save();
    return b;
  }

  #save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.bookings, null, 2));
    renameSync(tmp, this.file);
  }
}
