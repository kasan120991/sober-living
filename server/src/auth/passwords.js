import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id — memory-hard, so a leaked hash table is expensive to attack even
 * with GPUs. Chosen over bcrypt for that reason, and over a hand-rolled scrypt
 * setup because the parameters below are the maintained defaults.
 *
 * @node-rs/argon2 ships prebuilt binaries, so there is no node-gyp toolchain
 * requirement on a deploy host.
 */
const OPTIONS = {
  memoryCost: 19456, // 19 MiB — OWASP minimum for argon2id
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(plain) {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(storedHash, plain) {
  try {
    return await verify(storedHash, plain, OPTIONS)
  } catch {
    // A malformed or truncated hash is a failed login, not a 500.
    return false
  }
}
