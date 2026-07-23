from pathlib import Path

path = Path("tests/xyops-approvals.test.mjs")
text = path.read_text()
old = '''    assert.equal(launches.length, 2);

    response = await request(operator, `/api/integrations/runs/${repeatRunId}/rerun`, { confirm: true });'''
new = '''    assert.equal(launches.length, 2);
    const completedRepeatRun = db.runs.find((item) => item.id === repeatRunId);
    assert.ok(completedRepeatRun);
    completedRepeatRun.status = "success";
    completedRepeatRun.completed_at = Date.now();
    completedRepeatRun.updated_at = completedRepeatRun.completed_at;

    response = await request(operator, `/api/integrations/runs/${repeatRunId}/rerun`, { confirm: true });'''
if text.count(old) != 1:
    raise RuntimeError(f"rerun lifecycle anchor: expected one match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
