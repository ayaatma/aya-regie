/**
 * The login, tested where it can be tested without a browser and without a network.
 *
 * Two things are checked. First the translation of GoTrue's answers, which is pure and is the
 * part a régisseur actually reads when something goes wrong. Second that both cards render at
 * all: they are the one screen nobody sees while developing, since a developer with a session
 * never meets them and a machine with no Supabase configuration is sent straight past them, so a
 * hook called conditionally or a field read on nothing would ship unnoticed.
 *
 * These are server renders, like `screens.test.tsx`: no click, no submit, no Supabase client
 * ever constructed. That last point is the reason `LoginCard` and `AccountBar` ask for the
 * client inside their handlers rather than at the top.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { LoginCard } from './AuthGate.tsx';
import { AccountBar } from './AccountBar.tsx';
import { MIN_PASSWORD, frenchAuthError, passwordProblem } from './errors.ts';

test('a wrong password is named in French, and says neither which half was wrong', () => {
  const said = frenchAuthError('Invalid login credentials');
  assert.equal(said, 'Adresse email ou mot de passe incorrect.');
  assert.doesNotMatch(said, /adresse inconnue|compte introuvable/i);
});

test('somebody who was never invited is told to ask, not that the tool is broken', () => {
  assert.match(frenchAuthError('Signups not allowed for otp'), /invitée/);
});

test('the server rule on password length is repeated with the number the server gave', () => {
  assert.equal(
    frenchAuthError('Password should be at least 12 characters'),
    'Le mot de passe doit faire au moins 12 caractères.',
  );
});

test('an expired session says to reload rather than blaming the password', () => {
  assert.match(frenchAuthError('Auth session missing!'), /session a expiré/);
  assert.match(frenchAuthError('invalid refresh token'), /session a expiré/);
});

test('an unknown message is kept as it came, so it can be read and forwarded', () => {
  assert.equal(
    frenchAuthError('Database error granting user'),
    'La connexion a échoué: Database error granting user',
  );
});

test('every translation is in French and carries no em dash', () => {
  const messages = [
    'Invalid login credentials',
    'Signups not allowed for otp',
    'Email rate limit exceeded',
    'Email not confirmed',
    'Password should be at least 8 characters',
    'New password should be different from the old password',
    'Auth session missing!',
    'Reauthentication is required',
    'Unable to validate email address: invalid format',
    'Failed to fetch',
  ];
  for (const message of messages) {
    const said = frenchAuthError(message);
    assert.doesNotMatch(said, /—/, `em dash in the answer to ${message}`);
    assert.doesNotMatch(said, new RegExp(message.slice(0, 12), 'i'), `untranslated: ${message}`);
  }
});

test('a password too short is refused before the server is asked', () => {
  assert.match(passwordProblem('court', 'court') ?? '', new RegExp(String(MIN_PASSWORD)));
});

test('two different passwords are refused, and the same one twice is accepted', () => {
  assert.equal(passwordProblem('correcthorse', 'correcthorsr'), 'Les deux mots de passe ne sont pas identiques.');
  assert.equal(passwordProblem('correcthorse', 'correcthorse'), null);
});

test('the login card offers the password first and keeps the link within reach', () => {
  const html = renderToStaticMarkup(<LoginCard onVolunteer={() => {}} />);
  assert.match(html, /type="password"/);
  assert.match(html, /Se connecter/);
  assert.match(html, /mot de passe oublié/);
  // The volunteer's way out never disappears, whichever door is showing.
  assert.match(html, /Voir mon planning bénévole/);
});

test('the account bar names the account whose password is being changed', () => {
  const html = renderToStaticMarkup(<AccountBar email="regie@example.org" onClose={() => {}} />);
  assert.match(html, /regie@example.org/);
  // Two fields, because the second is what catches a typo repeated identically in the first,
  // and the address carried along so a password manager files what it saves under the account.
  assert.equal(html.match(/type="password"/g)?.length, 2);
  assert.match(html, /autocomplete="username"/i);
  assert.match(html, /Annuler/);
});

test('the account bar renders for somebody whose session carries no address', () => {
  const html = renderToStaticMarkup(<AccountBar email={null} onClose={() => {}} />);
  assert.match(html, /Choisir un mot de passe/);
});
