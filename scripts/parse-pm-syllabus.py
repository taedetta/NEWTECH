#!/usr/bin/env python3
"""Parse ASA Pilot's Manual PPL Syllabus (PM-S-P9-PD) extract into JS seed data."""
import re
import json

INPUT = r'c:\Users\Darth Vader\Desktop\TEST\scripts\syllabus-extract.txt'
OUTPUT = r'c:\Users\Darth Vader\Desktop\TEST\data\ppl-pm-syllabus.js'

STAGES = {
    1: 'Stage 1: Introduction to Flying',
    2: 'Stage 2: Solo',
    3: 'Stage 3: Cross-Country Flight',
    4: 'Stage 4: Prep for Checkride',
}

HEADER_RE = re.compile(
    r'(Stage (\d+) / Module (\d+)(?: and Stage Check)?'
    r'|Optional Stage (\d+) Review'
    r'|Solo Endorsements'
    r'|Alternate Airport Endorsement'
    r'|Cross-Country Endorsements'
    r'|Private Pilot Endorsements)',
    re.I,
)

def clean(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()

def strip_page_noise(s):
    s = re.sub(r'--- PAGE \d+ ---', '', s)
    s = re.sub(r'Aviation Supplies & Academics.*?Syllabus \d+', '', s)
    s = re.sub(r'\d+\s+The Pilot\'s Manual Series Private Pilot Syllabus', '', s)
    return s

def extract_tasks(content_block):
    tasks = []
    for line in content_block.split('\n'):
        line = line.strip()
        if not line:
            continue
        if re.match(r'^(Completion Standards|Assignment:|Recommended Reading:|Minimum 141|Lesson Time:|Date of Completion|Signature:|Time Flown|Stage Exam Score|Stage Check Successful)', line, re.I):
            break
        if line.startswith('•') or line.startswith('■') or line.startswith('–') or line.startswith('-'):
            t = re.sub(r'^[•■–\-]\s*', '', line).strip()
            if t and len(t) > 2 and not t.startswith('■'):
                tasks.append(t)
        elif re.match(r'^Flight [ABC]\b', line):
            tasks.append(line)
    return tasks[:30]

def parse_section(block):
    obj_match = re.search(
        r'Objective:?\s*(.*?)(?:Content:|Completion Standards:|Assignment:|Recommended Reading:|Minimum 141|$)',
        block, re.S | re.I,
    )
    content_match = re.search(
        r'Content:?\s*(.*?)(?:Completion Standards:|Assignment:|Recommended Reading:|Minimum 141|$)',
        block, re.S | re.I,
    )
    std_match = re.search(
        r'Completion Standards:?\s*(.*?)(?:Assignment:|Recommended Reading:|Minimum 141|Lesson Time:|$)',
        block, re.S | re.I,
    )
    assign_match = re.search(
        r'Assignment:?\s*(.*?)(?:Recommended Reading:|Minimum 141|Stage \d+ Exam|$)',
        block, re.S | re.I,
    )
    reading_match = re.search(
        r'Recommended Reading:?\s*(.*?)(?:Minimum 141|Lesson Time:|Stage \d+ /|$)',
        block, re.S | re.I,
    )

    objective = clean(obj_match.group(1)) if obj_match else ''
    content = content_match.group(1) if content_match else ''
    tasks = extract_tasks(content)
    completion = clean(std_match.group(1)) if std_match else ''
    reading = clean(assign_match.group(1)) if assign_match else ''
    if not reading and reading_match:
        reading = clean(reading_match.group(1))

    return objective, tasks, completion, reading

def parse_module_chunk(chunk, stage_num, module_num, is_stage_check=False, lesson_kind='module'):
    chunk = strip_page_noise(chunk)
    lessons = []

    type_labels = {
        'ground': 'Ground',
        'flight': 'Flight',
        'stage_exam': 'Stage Check',
        'review': 'Optional Review',
        'solo': 'First Solo',
        'endorsement': 'Endorsement',
    }

    if lesson_kind == 'review':
        ft = re.split(r'Flight Training', chunk, maxsplit=1)
        if len(ft) > 1 and clean(ft[1]):
            objective, tasks, completion, reading = parse_section(ft[1])
            lessons.append({
                'stage': STAGES[stage_num],
                'module': 0,
                'lesson_type': 'review',
                'name': f"Optional Review — Stage {stage_num}",
                'objective': objective,
                'reading_assignment': reading,
                'completion_standard': completion,
                'tasks': tasks,
            })
        return lessons

    if lesson_kind == 'solo':
        lessons.append({
            'stage': STAGES[stage_num],
            'module': 5,
            'lesson_type': 'solo',
            'name': 'First Solo Flight',
            'objective': 'Student demonstrates readiness for first solo flight per 14 CFR 61.87.',
            'reading_assignment': '',
            'completion_standard': 'Pre-solo written exam passed, solo endorsement issued, safe solo pattern work completed.',
            'tasks': ['Pre-solo written exam', 'Solo endorsement', 'Solo takeoffs and landings', 'Pattern work'],
        })
        return lessons

    if lesson_kind == 'endorsement':
        name = 'Endorsement'
        if 'Alternate Airport' in chunk[:80]:
            name = 'Alternate Airport Endorsement'
        elif 'Cross-Country' in chunk[:80]:
            name = 'Cross-Country Endorsements'
        elif 'Private Pilot' in chunk[:80]:
            name = 'Private Pilot Endorsements & Checkride Prep'
        lessons.append({
            'stage': STAGES[stage_num],
            'module': module_num,
            'lesson_type': 'endorsement',
            'name': name,
            'objective': clean(re.search(r'Objective:?\s*(.*?)(?:Content:|Completion|$)', chunk, re.S | re.I).group(1)) if re.search(r'Objective:', chunk, re.I) else 'Complete required endorsements.',
            'reading_assignment': '',
            'completion_standard': '',
            'tasks': extract_tasks(chunk) or ['Endorsement issued', 'Requirements reviewed with student'],
        })
        return lessons

    # Tokenize alternating Ground Training / Flight Training sections (PDF interleaves them)
    tokens = re.split(r'(Ground Training|Flight Training)', chunk)
    i = 1
    while i < len(tokens):
        kind = tokens[i]
        body = tokens[i + 1] if i + 1 < len(tokens) else ''
        i += 2
        if not clean(body):
            continue
        if kind.lower().startswith('ground'):
            objective, tasks, completion, reading = parse_section(body)
            if not objective and not tasks:
                continue
            lessons.append({
                'stage': STAGES[stage_num],
                'module': module_num,
                'lesson_type': 'ground',
                'name': f'Ground — Module {module_num}',
                'objective': objective,
                'reading_assignment': reading,
                'completion_standard': completion,
                'tasks': tasks,
            })
        else:
            objective, tasks, completion, reading = parse_section(body)
            if not objective and not tasks:
                continue
            ltype = 'stage_exam' if is_stage_check else 'flight'
            lessons.append({
                'stage': STAGES[stage_num],
                'module': module_num,
                'lesson_type': ltype,
                'name': f"{'Stage Check' if ltype == 'stage_exam' else 'Flight'} — Module {module_num}",
                'objective': objective,
                'reading_assignment': reading,
                'completion_standard': completion,
                'tasks': tasks,
            })

    return lessons

with open(INPUT, encoding='utf-8') as f:
    text = f.read()

start = text.find('Stage 1 / Module 1')
if start < 0:
    raise SystemExit('Could not find syllabus lesson content in extract')
text = text[start:]

lessons = []
order = 0
headers = list(HEADER_RE.finditer(text))

for idx, match in enumerate(headers):
    end = headers[idx + 1].start() if idx + 1 < len(headers) else len(text)
    chunk = text[match.end():end]

    if match.group(2):  # Stage N / Module M
        stage_num = int(match.group(2))
        module_num = int(match.group(3))
        is_check = 'Stage Check' in match.group(1)
        parsed = parse_module_chunk(chunk, stage_num, module_num, is_stage_check=is_check, lesson_kind='module')
    elif match.group(4):  # Optional review
        stage_num = int(match.group(4))
        parsed = parse_module_chunk(chunk, stage_num, 0, lesson_kind='review')
    elif 'Solo Endorsements' in match.group(1):
        parsed = parse_module_chunk(chunk, 2, 5, lesson_kind='solo')
    elif 'Endorsement' in match.group(1) or 'Private Pilot Endorsements' in match.group(1):
        stage_num = 3 if 'Cross-Country' in match.group(1) else (4 if 'Private Pilot' in match.group(1) else 3)
        parsed = parse_module_chunk(chunk, stage_num, 0, lesson_kind='endorsement')
    else:
        continue

    for les in parsed:
        order += 1
        les['order_index'] = order
        lessons.append(les)

def merge_and_fix_modules(lessons):
    """PDF layout interleaves modules — re-pair ground/flight and fix module numbers."""
    by_stage = {}
    for les in lessons:
        by_stage.setdefault(les['stage'], []).append(les)

    fixed = []
    global_order = 0
    for stage in STAGES.values():
        items = by_stage.get(stage, [])
        if not items:
            continue
        items.sort(key=lambda x: x['order_index'])
        merged = []
        for les in items:
            if les['lesson_type'] in ('review', 'solo', 'endorsement'):
                merged.append(dict(les))
                continue
            merged.append(dict(les))

        # Drop orphan flights caused by PDF column layout (back-to-back flights)
        filtered = []
        for les in merged:
            if les['lesson_type'] in ('flight', 'stage_exam') and filtered:
                prev = filtered[-1]
                if prev['lesson_type'] in ('flight', 'stage_exam'):
                    continue
            filtered.append(les)
        merged = filtered

        mod = 1
        pending_ground = False
        for les in merged:
            lt = les['lesson_type']
            if lt in ('review', 'solo', 'endorsement'):
                global_order += 1
                les['order_index'] = global_order
                fixed.append(les)
                continue
            if lt == 'ground':
                les['module'] = mod
                les['name'] = f'Ground — Module {mod}'
                pending_ground = True
            elif lt in ('flight', 'stage_exam'):
                if not pending_ground:
                    mod = max(1, mod)
                les['module'] = mod
                obj = (les.get('objective') or '').lower()
                is_check = lt == 'stage_exam' or 'stage check' in obj or 'review all stage' in obj
                if is_check:
                    les['lesson_type'] = 'stage_exam'
                    les['name'] = f'Stage Check — Module {mod}'
                else:
                    les['name'] = f'Flight — Module {mod}'
                mod += 1
                pending_ground = False
            global_order += 1
            les['order_index'] = global_order
            fixed.append(les)
    return fixed

lessons = merge_and_fix_modules(lessons)

with open(OUTPUT, 'w', encoding='utf-8') as out:
    out.write("'use strict';\n\n")
    out.write("/** ASA The Pilot\\'s Manual — Private Pilot Syllabus, 9th Edition (PM-S-P9-PD) */\n")
    out.write('module.exports = ')
    json.dump({'program': {
        'name': 'Private Pilot License',
        'code': 'PPL',
        'description': "ASA The Pilot's Manual Private Pilot Syllabus — 9th Edition (Part 61 & 141) [PM-S-P9-PD]",
        'syllabus_ref': 'PM-S-P9-PD',
    }, 'lessons': lessons}, out, indent=2)
    out.write(';\n')

print(f'Wrote {len(lessons)} lessons to {OUTPUT}')
for s in STAGES.values():
    cnt = sum(1 for l in lessons if l['stage'] == s)
    print(f'  {s}: {cnt}')
