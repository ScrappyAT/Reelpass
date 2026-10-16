import { seatHolds } from './src/redis/seatHolds';
async function main() {
  await new Promise(r => setTimeout(r, 3000));
  console.log(seatHolds.isLive());
  await seatHolds.close();
}
main();
