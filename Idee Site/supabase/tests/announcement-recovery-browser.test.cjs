// Production composer + disposable PostgreSQL RPCs. No live delivery or storage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { fixture, uid } = require('./announcement-panel.test.cjs');
const root = join(__dirname, '../..');

test('announcement previews recover from rejected approval without replacing uncertain campaigns', async t => {
    const f = await fixture();
    let browser;
    try {
        await f.root('update spotivity_private.announcement_panel_config set ready=true');
        await f.root("update spotivity_private.notification_config set ready=true,booking_webhook_url='https://hook.eu1.make.com/fixtureWebhook123456789'");
        browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
        const types = {
            admin_announcement_preview: ['uuid', 'text', 'text', 'text', 'text'],
            admin_announcement_send: ['uuid', 'integer', 'text'],
            admin_announcement_history: ['timestamptz', 'uuid']
        };
        const args = {
            admin_announcement_preview: ['p_campaign_id', 'p_audience', 'p_subject', 'p_message', 'p_image_path'],
            admin_announcement_send: ['p_campaign_id', 'p_expected_count', 'p_fingerprint'],
            admin_announcement_history: ['p_before', 'p_before_id']
        };
        const requests = async () => Number((await f.root('select count(*) n from net.test_requests')).rows[0].n);
        const campaigns = async () => Number((await f.root('select count(*) n from spotivity_private.announcement_campaigns')).rows[0].n);
        async function composer(image = false) {
            const page = await browser.newPage();
            const calls = [], errors = [];
            let loseSendResponse = false;
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => route.request().isNavigationRequest()
                ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="base-admin-workspace"><div class="base-admin-tools"></div></div>' })
                : route.abort());
            await page.exposeFunction('recoveryRPC', async (name, input) => {
                assert.ok(types[name], name);
                calls.push({ name, args: input });
                try {
                    const result = await f.as(4, `select public.${name}(${types[name].map((type, i) => '$' + (i + 1) + '::' + type).join(',')}) v`, args[name].map(key => input[key] ?? null));
                    if (name === 'admin_announcement_send' && loseSendResponse) {
                        loseSendResponse = false;
                        return { data: null, error: { code: 'NETWORK_ERROR' } };
                    }
                    return { data: result.rows[0].v, error: null };
                } catch (error) { return { data: null, error: { code: error.code } }; }
            });
            await page.exposeFunction('recoveryUpload', async (path, size, mimetype) => {
                calls.push({ name: 'upload', path });
                try {
                    await f.as(4, "insert into storage.objects(bucket_id,name,metadata)values('announcement_images',$1,$2::jsonb)", [path, JSON.stringify({ size, mimetype })]);
                    return { error: null };
                } catch (error) { return { error: { statusCode: error.code === '23505' ? 409 : 400 } }; }
            });
            await page.goto('https://announcement-recovery.test/');
            await page.evaluate(readFileSync(join(root, 'js/admin-announcements.js'), 'utf8'));
            await page.evaluate(userId => {
                createAnnouncementPanel({ rpc: recoveryRPC, storage: { from: () => ({ upload: (path, file) => recoveryUpload(path, file.size, file.type) }) } });
                dispatchEvent(new CustomEvent('spotivity:admin-role', { detail: { userId, isSuper: true } }));
            }, uid(4));
            await page.locator('#btn-admin-announcements').click();
            await page.waitForFunction(() => document.querySelector('#ann-transport').textContent.startsWith('Trimitere disponibilă.'));
            await page.locator('#ann-subject').fill('Anunț de verificat');
            await page.locator('#ann-message').fill('Același mesaj după o previzualizare nouă.');
            if (image) await page.locator('#ann-image').setInputFiles(join(root, 'assets/imagini/TenisVFinal.jpg'));
            await page.locator('#ann-preview').click();
            await page.waitForFunction(() => !document.querySelector('#ann-review').hidden && !document.querySelector('#ann-fields').disabled);
            return {
                page, calls, errors,
                current: () => calls.filter(call => call.name === 'admin_announcement_preview').at(-1).args.p_campaign_id,
                loseResponse: () => { loseSendResponse = true; },
                approve: async () => { await page.locator('#ann-confirm').check(); await page.locator('#ann-send').click(); }
            };
        }
        async function repreview(ui, previous) {
            await ui.page.locator('#ann-preview').click();
            await ui.page.waitForFunction(previous => !document.querySelector('#ann-fields').disabled
                && !document.querySelector('#ann-review').hidden
                && document.querySelector('#ann-count').textContent.startsWith(previous.count + ' '), previous, { timeout: 3000 });
            assert.notEqual(ui.current(), previous.id, 'A rejected immutable preview needs a fresh campaign UUID');
            assert.equal(await ui.page.locator('#ann-confirm').isChecked(), false);
            assert.equal(await ui.page.locator('#ann-send').isEnabled(), false, 'Fresh recipients require a new explicit approval');
        }

        await t.test('recipient changes recover through Preview with the same content and selected image', async () => {
            const ui = await composer(true);
            try {
                const original = ui.current(), before = await requests();
                await f.root("insert into auth.users(id,email,email_confirmed_at)values($1,'new-recipient@example.test',statement_timestamp())", [uid(39901)]);
                await ui.approve();
                await ui.page.waitForFunction(() => document.querySelector('#ann-status').textContent.includes('Destinatarii s-au schimbat') && !document.querySelector('#ann-fields').disabled);
                assert.equal(await requests(), before, 'Rejected approval never queued the old snapshot');
                assert.equal(await ui.page.locator('#ann-send').isEnabled(), false);
                assert.equal(await ui.page.locator('#ann-confirm').isChecked(), false);
                await repreview(ui, { id: original, count: 3 });
                const fresh = ui.current(), uploads = ui.calls.filter(call => call.name === 'upload');
                assert.equal(uploads.length, 2);
                assert.ok(uploads[0].path.includes('/' + original + '/'));
                assert.ok(uploads[1].path.includes('/' + fresh + '/'), 'The image belongs to the new immutable campaign');
                assert.equal(await ui.page.locator('#ann-subject').inputValue(), 'Anunț de verificat');
                await ui.approve();
                await ui.page.waitForFunction(() => document.querySelector('#ann-status').textContent.includes('pus în coadă') && !document.querySelector('#ann-fields').disabled);
                assert.equal(await requests(), before + 1);
                const rows = (await f.root('select id,status from spotivity_private.announcement_campaigns where id=any($1::uuid[])', [[original, fresh]])).rows;
                assert.equal(rows.find(row => row.id === original).status, 'preview');
                assert.equal(rows.find(row => row.id === fresh).status, 'approved');
                assert.deepEqual(ui.errors, []);
            } finally { await ui.page.close(); }
        });

        await t.test('expired approval recovers without requiring a content edit', async () => {
            const ui = await composer();
            try {
                const original = ui.current(), before = await requests();
                await f.root("update spotivity_private.announcement_campaigns set created_at=statement_timestamp()-interval '25 hours' where id=$1", [original]);
                await ui.approve();
                await ui.page.waitForFunction(() => document.querySelector('#ann-status').textContent.includes('Previzualizarea a expirat') && !document.querySelector('#ann-fields').disabled);
                await repreview(ui, { id: original, count: 3 });
                assert.equal(await requests(), before);
            } finally { await ui.page.close(); }
        });

        await t.test('Preview refreshes a changed audience even before approval is attempted', async () => {
            const ui = await composer();
            try {
                const original = ui.current(), before = await requests();
                await f.root("insert into auth.users(id,email,email_confirmed_at)values($1,'another-recipient@example.test',statement_timestamp())", [uid(39902)]);
                await repreview(ui, { id: original, count: 4 });
                assert.equal(await requests(), before);
            } finally { await ui.page.close(); }
        });

        await t.test('unavailable transport retains the saved campaign for safe retry', async () => {
            const ui = await composer();
            try {
                const original = ui.current(), before = await campaigns();
                await f.root('update spotivity_private.announcement_panel_config set ready=false');
                await ui.approve();
                await ui.page.waitForFunction(() => document.querySelector('#ann-status').textContent.includes('Trimiterea nu este disponibilă') && !document.querySelector('#ann-fields').disabled);
                await ui.page.locator('#ann-preview').click();
                await ui.page.waitForFunction(() => !document.querySelector('#ann-fields').disabled);
                assert.equal(ui.current(), original);
                assert.equal(await campaigns(), before);
            } finally {
                await ui.page.close();
                await f.root('update spotivity_private.announcement_panel_config set ready=true');
            }
        });

        await t.test('lost approval response, expiry and later audience change never create another campaign', async () => {
            const ui = await composer(true);
            try {
                const original = ui.current(), before = await campaigns(), queued = await requests();
                ui.loseResponse();
                await ui.approve();
                await ui.page.waitForFunction(() => document.querySelector('#ann-status').textContent.includes('Nu am putut confirma operația') && !document.querySelector('#ann-fields').disabled);
                assert.equal(await requests(), queued + 1, 'The successful approval response was lost');
                await f.root("update spotivity_private.announcement_campaigns set approved_at=statement_timestamp()-interval '25 hours',approved_until=statement_timestamp()-interval '1 hour' where id=$1", [original]);
                await ui.approve();
                await ui.page.waitForFunction(() => document.querySelector('#ann-status').textContent.includes('Previzualizarea a expirat') && !document.querySelector('#ann-fields').disabled);
                await f.root("insert into auth.users(id,email,email_confirmed_at)values($1,'after-approval@example.test',statement_timestamp())", [uid(39903)]);
                await ui.page.locator('#ann-preview').click();
                await ui.page.waitForFunction(() => !document.querySelector('#ann-fields').disabled);
                assert.equal(ui.current(), original, 'An approved snapshot must retain its original recipients and UUID');
                assert.equal(await campaigns(), before);
                assert.equal(await requests(), queued + 1);
                assert.equal(ui.calls.filter(call => call.name === 'upload').length, 1, 'The frozen approved image is not uploaded again');
                assert.equal(await ui.page.locator('#ann-confirm').isChecked(), false);
                assert.match(await ui.page.locator('#ann-status').innerText(), /deja aprobat/);
                assert.deepEqual(ui.errors, []);
            } finally { await ui.page.close(); }
        });
    } finally {
        await browser?.close();
        await f.pg.close();
    }
});
