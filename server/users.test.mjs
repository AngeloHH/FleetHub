import { describe, expect, test } from 'vitest'
import { Users, ROLES, seal, matches, checkPassword, passwordRules, PASSWORD_RULES } from './users.mjs'

const bueno = {
  fullName: 'Ricardo Salgado Ibarra',
  email: 'r.salgado@fleethub.mx',
  phoneCode: '+52',
  phone: '5541287730',
  language: 'es',
  password: 'Una-Clave-Larga1',
}

const nuevo = () => new Users([])

describe('crear', () => {
  test('devuelve solamente los campos públicos acordados', () => {
    const { user } = nuevo().create(bueno)
    expect(Object.keys(user).sort()).toEqual(
      ['companyId', 'createdAt', 'email', 'fullName', 'id', 'language', 'passwordChangedAt', 'phone', 'phoneCode', 'role', 'staff', 'suspension', 'updatedAt'].sort(),
    )
  })

  test('la contraseña no sale por ninguna puerta', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(user.password).toBeUndefined()
    expect(users.get(user.id).password).toBeUndefined()
    expect(users.list()[0].password).toBeUndefined()
    expect(users.verify(bueno.email, bueno.password).user.password).toBeUndefined()
  })

  test('pero sí se guarda, y en formato PHC', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.find(user.id).password).toMatch(/^\$pbkdf2-sha256\$i=100000\$[\w+/]+\$[\w+/]+$/)
  })

  test('el id es un UUID', () => {
    const { user } = nuevo().create(bueno)
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('usa el UUID reservado por el servidor cuando se lo entregan', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(nuevo().create({ ...bueno, id }).user.id).toBe(id)
  })

  test('dos cuentas no comparten id', () => {
    const users = nuevo()
    const a = users.create(bueno).user
    const b = users.create({ ...bueno, email: 'otra@fleethub.mx', phone: '5541287731' }).user
    expect(a.id).not.toBe(b.id)
  })

  test('el rol por defecto es visitante', () => {
    expect(nuevo().create(bueno).user.role).toBe('VISITANTE')
  })

  test('acepta los tres roles, por nombre o por nivel, y ningún otro', () => {
    for (const role of ROLES) expect(nuevo().create({ ...bueno, role }).user.role).toBe(role)
    for (const [tier, name] of ROLES.entries())
      expect(nuevo().create({ ...bueno, role: tier }).user.role).toBe(name)
    // El 3 es soporte, y soporte no se concede: se abre desde staff.mjs.
    for (const role of ['SOPORTE', 3, -1, 1.5, null])
      expect(nuevo().create({ ...bueno, role }).error).toBe('INVALID_ROLE')
  })

  test('guardado el rol es el nivel, aunque salga con nombre', () => {
    // Es lo que pide la columna: un entero, no una cadena.
    const users = nuevo()
    const { user } = users.create({ ...bueno, role: 'ADMINISTRADOR' })
    expect(user.role).toBe('ADMINISTRADOR')
    expect(users.table.find((row) => row.id === user.id).role).toBe(2)
  })

  test('el idioma se asume, no se exige', () => {
    const { user } = nuevo().create({ ...bueno, language: undefined })
    expect(user.language).toBe('es')
  })

  test('el correo se guarda en minúsculas y sin espacios', () => {
    const { user } = nuevo().create({ ...bueno, email: '  R.Salgado@FleetHub.MX ' })
    expect(user.email).toBe('r.salgado@fleethub.mx')
  })
})

describe('lo que no entra', () => {
  const malos = [
    ['MISSING_NAME', { fullName: '   ' }],
    ['INVALID_EMAIL', { email: 'no-es-un-correo' }],
    ['INVALID_EMAIL', { email: 'a@b' }],
    ['INVALID_PHONE', { phone: '+525541287730' }],
    ['INVALID_PHONE', { phone: '55 4128 7730' }],
    ['INVALID_PHONE', { phone: '123' }],
    ['INVALID_PHONE_CODE', { phoneCode: '52' }],
    ['INVALID_PHONE_CODE', { phoneCode: '+0' }],
    ['INVALID_PHONE_CODE', { phoneCode: '+12345' }],
    ['INVALID_LANGUAGE', { language: 'MX' }],
    ['INVALID_LANGUAGE', { language: 'espanol' }],
    ['WEAK_PASSWORD', { password: 'corta' }],
    ['WEAK_PASSWORD', { password: undefined }],
  ]
  for (const [error, campo] of malos) {
    test(`${error}: ${JSON.stringify(campo)}`, () => {
      expect(nuevo().create({ ...bueno, ...campo }).error).toBe(error)
    })
  }

  test('el mismo correo no se da dos veces', () => {
    const users = nuevo()
    users.create(bueno)
    expect(users.create({ ...bueno, email: 'R.SALGADO@fleethub.mx' }).error).toBe('EMAIL_TAKEN')
  })

  test('lo rechazado no deja fila a medias', () => {
    const users = nuevo()
    users.create({ ...bueno, phone: 'mal' })
    expect(users.list()).toHaveLength(0)
  })
})

describe('contraseña', () => {
  test('la buena entra y la mala no', () => {
    const users = nuevo()
    users.create(bueno)
    expect(users.verify(bueno.email, bueno.password).ok).toBe(true)
    expect(users.verify(bueno.email, 'otra-cosa').error).toBe('INVALID_CREDENTIALS')
  })

  test('una cuenta que no existe falla igual que una contraseña mala', () => {
    expect(nuevo().verify('nadie@fleethub.mx', 'lo-que-sea').error).toBe('INVALID_CREDENTIALS')
  })

  test('la misma contraseña no da el mismo guardado', () => {
    expect(seal('igual')).not.toBe(seal('igual'))
  })

  test('verifica con las rondas de su propia fila, no con las de ahora', () => {
    const viejo = seal('clave-de-antes', 1_000)
    expect(viejo).toContain('$i=1000$')
    expect(matches('clave-de-antes', viejo)).toBe(true)
    expect(matches('otra', viejo)).toBe(false)
  })

  test('un guardado con mala forma no valida nunca', () => {
    for (const roto of ['', null, 'texto', '$argon2id$i=1$a$b', '$pbkdf2-sha256$i=0$a$b'])
      expect(matches('lo-que-sea', roto)).toBe(false)
  })

  test('cambiarla exige la vieja', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.setPassword(user.id, 'La-Siguiente1', { current: 'mal' }).error).toBe('INVALID_CREDENTIALS')
    expect(users.setPassword(user.id, 'corta', { current: bueno.password }).error).toBe('WEAK_PASSWORD')
    expect(users.setPassword(user.id, 'La-Siguiente1', { current: bueno.password }).ok).toBe(true)
    expect(users.verify(bueno.email, 'La-Siguiente1').ok).toBe(true)
  })

  test('olvidarse de la vieja no la cambia', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.setPassword(user.id, 'La-Siguiente1').error).toBe('INVALID_CREDENTIALS')
    expect(users.verify(bueno.email, bueno.password).ok).toBe(true)
  })

  test('con reset se cambia sin la vieja, que es el camino del código', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.setPassword(user.id, 'La-Siguiente1', { reset: true }).ok).toBe(true)
    expect(users.verify(bueno.email, 'La-Siguiente1').ok).toBe(true)
  })

  test('la nueva no puede ser la vieja', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.setPassword(user.id, bueno.password, { current: bueno.password }).error).toBe('SAME_PASSWORD')
    expect(users.setPassword(user.id, bueno.password, { reset: true }).error).toBe('SAME_PASSWORD')
  })

  test('lo rechazado deja la de antes en pie', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    users.setPassword(user.id, 'corta', { current: bueno.password })
    expect(users.verify(bueno.email, bueno.password).ok).toBe(true)
  })

  test('una cuenta que no existe no cambia de contraseña', () => {
    expect(nuevo().setPassword('no-existe', 'La-Siguiente1', { reset: true }).error).toBe('UNKNOWN')
  })
})

describe('editar', () => {
  test('cambia sólo lo que se nombra', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    const { user: tras } = users.update(user.id, { language: 'en', role: 'ADMINISTRADOR' })
    expect(tras.language).toBe('en')
    expect(tras.role).toBe('ADMINISTRADOR')
    expect(tras.fullName).toBe(bueno.fullName)
    expect(tras.email).toBe(bueno.email)
  })

  test('no deja robar el correo de otra cuenta', () => {
    const users = nuevo()
    const a = users.create(bueno).user
    users.create({ ...bueno, email: 'otra@fleethub.mx', phone: '5541287731' })
    expect(users.update(a.id, { email: 'otra@fleethub.mx' }).error).toBe('EMAIL_TAKEN')
  })

  test('conservar el propio correo no es robárselo', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.update(user.id, { email: bueno.email }).ok).toBe(true)
  })

  test('lo rechazado no cambia nada', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    users.update(user.id, { phone: 'mal' })
    expect(users.get(user.id).phone).toBe(bueno.phone)
    expect(users.get(user.id).phoneCode).toBe(bueno.phoneCode)
  })

  test('el prefijo y el número se guardan aparte', () => {
    const { user } = nuevo().create(bueno)
    expect(user.phoneCode).toBe('+52')
    expect(user.phone).toBe('5541287730')
  })

  test('el prefijo es obligatorio y no se deduce de un país', () => {
    expect(nuevo().create({ ...bueno, phoneCode: undefined }).error).toBe('INVALID_PHONE_CODE')
  })

  test('el teléfono también identifica una cuenta y no se repite', () => {
    const users = nuevo()
    users.create(bueno)
    expect(users.verify({ phone: bueno.phone }, bueno.password).ok).toBe(true)
    expect(users.create({ ...bueno, email: 'otra@fleethub.mx' }).error).toBe('PHONE_TAKEN')
  })

  test('cambiar sólo el prefijo deja el número donde estaba', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    const { user: tras } = users.update(user.id, { phoneCode: '+1' })
    expect(tras.phoneCode).toBe('+1')
    expect(tras.phone).toBe(bueno.phone)
  })

  test('el tope de E.164 es de la suma, no de cada parte', () => {
    const users = nuevo()
    // Catorce dígitos con un prefijo de uno caben; con uno de tres, no.
    const { user } = users.create({ ...bueno, phoneCode: '+1', phone: '12345678901234' })
    expect(user.phone).toBe('12345678901234')
    expect(users.update(user.id, { phoneCode: '+591' }).error).toBe('INVALID_PHONE')
    expect(users.get(user.id).phoneCode).toBe('+1')
  })

  test('una cuenta que no existe no se edita', () => {
    expect(nuevo().update('no-existe', { language: 'en' }).error).toBe('UNKNOWN')
  })

  test('un error tardío tampoco deja cambios parciales', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    expect(users.update(user.id, { fullName: 'Nombre Cambiado', email: 'mal' }).error).toBe('INVALID_EMAIL')
    expect(users.get(user.id).fullName).toBe(bueno.fullName)
  })
})

describe('la tabla', () => {
  test('se muta en sitio, que es lo que el servidor guarda', () => {
    const tabla = []
    new Users(tabla).create(bueno)
    expect(tabla).toHaveLength(1)
    expect(tabla[0].password).toBeDefined()
  })

  test('avisa por save en cada escritura', () => {
    let veces = 0
    const users = new Users([], { save: () => (veces += 1) })
    const { user } = users.create(bueno)
    users.update(user.id, { language: 'en' })
    users.remove(user.id)
    expect(veces).toBe(3)
  })

  test('la hora sale de now, para poder probarla', () => {
    const cuando = new Date('2020-01-02T03:04:05.000Z')
    const users = new Users([], { now: () => cuando })
    expect(users.create(bueno).user).toMatchObject({
      createdAt: cuando.toISOString(), updatedAt: cuando.toISOString(), passwordChangedAt: cuando.toISOString(),
    })
  })
})

describe('la fuerza de la contraseña', () => {
  test('las cuatro reglas son expresiones regulares y nada más', () => {
    expect(Object.keys(PASSWORD_RULES)).toEqual([
      'min-length', 'uppercase', 'digit', 'only-digits',
    ])
    for (const re of Object.values(PASSWORD_RULES)) expect(re).toBeInstanceOf(RegExp)
  })

  test('passwordRules lleva la expresión, no el resultado', () => {
    expect(passwordRules().rules).toEqual({
      'min-length': '/.{8,}/su',
      uppercase: '/\\p{Lu}/u',
      digit: '/\\p{Nd}/u',
      'only-digits': '/^\\p{Nd}+$/u',
    })
  })

  test('las reglas no dependen de la contraseña comprobada', () => {
    expect(passwordRules()).toEqual(nuevo().passwordRules())
  })

  test('la expresión que viaja reconstruye la regla que se aplicó', () => {
    const { rules } = passwordRules()
    for (const [nombre, literal] of Object.entries(rules)) {
      const [, source, flags] = /^\/(.*)\/([a-z]*)$/s.exec(literal)
      const rehecha = new RegExp(source, flags)
      expect(rehecha.source).toBe(PASSWORD_RULES[nombre].source)
      expect(rehecha.flags).toBe(PASSWORD_RULES[nombre].flags)
    }
  })

  test('sin las banderas la regla sería otra, y por eso viajan', () => {
    expect(/\p{Lu}/u.test('Ñ')).toBe(true)
    expect(new RegExp('\\p{Lu}').test('Ñ')).toBe(false)
  })

  test('una buena las cumple todas', () => {
    expect(checkPassword('Una-Clave-Larga1').failed).toEqual([])
  })

  test('checkPassword devuelve solamente failed', () => {
    expect(Object.keys(checkPassword('abc'))).toEqual(['failed'])
  })

  test('passwordRules devuelve reglas y cuáles rechazan al coincidir', () => {
    expect(passwordRules()).toEqual({
      rules: {
        'min-length': '/.{8,}/su',
        uppercase: '/\\p{Lu}/u',
        digit: '/\\p{Nd}/u',
        'only-digits': '/^\\p{Nd}+$/u',
      },
      reject: ['only-digits'],
    })
    expect(Object.keys(passwordRules())).toEqual(['rules', 'reject'])
    expect(nuevo().passwordRules()).toEqual(passwordRules())
  })

  test('no hay ok: se lee de que failed esté vacía', () => {
    expect(checkPassword('Una-Clave-Larga1').ok).toBeUndefined()
    expect(checkPassword('abc').ok).toBeUndefined()
  })

  test('failed son los nombres de las que fallan', () => {
    expect(checkPassword('clave-larga1').failed).toEqual(['uppercase'])
    expect(checkPassword('12345678').failed).toEqual(['uppercase', 'only-digits'])
  })

  test('fallar una sola ya no entra', () => {
    const users = nuevo()
    expect(users.create({ ...bueno, password: 'una-frase-larga-y-buena' }).error).toBe('WEAK_PASSWORD')
    expect(users.create({ ...bueno, email: 'b@f.mx', password: 'Ab1' }).error).toBe('WEAK_PASSWORD')
    expect(users.create({ ...bueno, email: 'c@f.mx', password: '12345678' }).error).toBe('WEAK_PASSWORD')
  })

  test('dice todo lo que falta de una vez, no de uno en uno', () => {
    expect(checkPassword('abc').failed).toEqual(['min-length', 'uppercase', 'digit'])
  })

  const casos = [
    ['corta', 'Ab1', ['min-length']],
    ['sin mayúscula', 'clave-larga1', ['uppercase']],
    ['sin dígito', 'Clave-Larga', ['digit']],
    ['sólo números', '12345678', ['uppercase', 'only-digits']],
    ['vacía', '', ['min-length', 'uppercase', 'digit']],
  ]
  for (const [nombre, clave, falla] of casos) {
    test(nombre, () => expect(checkPassword(clave).failed).toEqual(falla))
  }

  test('la mayúscula es la de cualquier idioma, no sólo A-Z', () => {
    expect(checkPassword('Ñandú-Del-Sur1').failed).toEqual([])
    expect(checkPassword('Ópera-Nocturna9').failed).toEqual([])
  })

  test('la longitud cuenta puntos de código, no mitades de emoji', () => {
    // Ocho emoji son ocho caracteres; sin la bandera `u` contarían dieciséis.
    expect(checkPassword('🔑🔑🔑🔑🔑🔑🔑🔑').failed).not.toContain('min-length')
    expect(checkPassword('🔑🔑🔑').failed).toContain('min-length')
  })

  test('un salto de línea es un carácter como otro', () => {
    expect(checkPassword('Ab1\n\n\n\n\n').failed).not.toContain('min-length')
  })

  test('crear con una débil dice por qué, regla por regla', () => {
    const out = nuevo().create({ ...bueno, password: '12345678' })
    expect(out.error).toBe('WEAK_PASSWORD')
    expect(out.failed).toEqual(['uppercase', 'only-digits'])
  })

  test('cambiarla por una débil también lo dice', () => {
    const users = nuevo()
    const { user } = users.create(bueno)
    const out = users.setPassword(user.id, 'clave-larga', { current: bueno.password })
    expect(out.error).toBe('WEAK_PASSWORD')
    expect(out.failed).toEqual(['uppercase', 'digit'])
  })

  test('la clase la expone sin tocar ninguna cuenta', () => {
    const users = nuevo()
    expect(users.checkPassword('abc').failed).toContain('min-length')
    expect(users.list()).toHaveLength(0)
  })

  test('«sólo números» no puede fallar sola', () => {
    // Si hay una mayúscula, ya no es sólo números. La regla es redundante
    // frente a UPPERCASE y sólo existe porque la pantalla la enseña aparte.
    for (const clave of ['12345678', '1', '', 'Ab1', 'abc'])
      expect(checkPassword(clave).failed).not.toEqual(['only-digits'])
  })
})
