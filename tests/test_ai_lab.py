"""
Unit and System Test Suite for Autonomous Self-Evolving AI Development Lab
Tests: Fast Router Slugification, FastMCP AST Syntax Validator, SQLite WAL, Circuit Breaker, Runner Execution
"""

import ast
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest

def canonicalize_prompt_to_key(prompt: str) -> str:
    """Fast, deterministic intent key generator using token normalization & slugification."""
    clean = prompt.lower().strip()
    clean = re.sub(r"[^\w\s-]", "", clean)
    stop_words = {"the", "a", "an", "for", "to", "in", "and", "or", "of", "please", "can", "you", "my", "run"}
    tokens = [t for t in clean.split() if t not in stop_words and len(t) > 0]
    slug = "_".join(tokens[:5])
    return slug or "unnamed_intent"

def validate_python_syntax(code: str) -> dict:
    """FastMCP AST syntax validator and contract check for def execute(data=None)."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"valid": False, "error": f"SyntaxError at line {e.lineno}, offset {e.offset}: {e.msg}"}
    
    has_execute = False
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "execute":
            has_execute = True
            if len(node.args.args) == 0:
                return {"valid": False, "error": "Function 'execute' must accept at least 1 argument: 'data=None'."}
            break
            
    if not has_execute:
        return {"valid": False, "error": "Missing mandatory entrypoint 'def execute(data=None):'."}
        
    return {"valid": True, "error": None}

class TestFastRouter(unittest.TestCase):
    """Test Dumb Fast Router prompt canonicalization and slugification."""

    def test_canonicalize_standard_prompt(self):
        prompt = "Compute SHA256 checksum on string payload"
        key = canonicalize_prompt_to_key(prompt)
        self.assertEqual(key, "compute_sha256_checksum_on_string")

    def test_canonicalize_with_stopwords_and_punctuation(self):
        prompt = "Please, can you calculate the fibonacci sequence for my input?!"
        key = canonicalize_prompt_to_key(prompt)
        self.assertEqual(key, "calculate_fibonacci_sequence_input")

    def test_canonicalize_empty_fallback(self):
        prompt = "   "
        key = canonicalize_prompt_to_key(prompt)
        self.assertEqual(key, "unnamed_intent")

    def test_canonicalize_max_token_truncation(self):
        prompt = "one two three four five six seven eight nine ten"
        key = canonicalize_prompt_to_key(prompt)
        tokens = key.split("_")
        self.assertLessEqual(len(tokens), 5)


class TestASTSyntaxValidator(unittest.TestCase):
    """Test FastMCP AST pre-flight validation before script persistence."""

    def test_valid_execute_entrypoint(self):
        code = '''
def execute(data=None):
    return {"status": "success", "data": data}
'''
        res = validate_python_syntax(code)
        self.assertTrue(res["valid"])
        self.assertIsNone(res["error"])

    def test_invalid_syntax_error(self):
        code = '''
def execute(data=None)
    missing colon here
'''
        res = validate_python_syntax(code)
        self.assertFalse(res["valid"])
        self.assertIn("SyntaxError", res["error"])

    def test_missing_execute_function(self):
        code = '''
def helper():
    return 42
'''
        res = validate_python_syntax(code)
        self.assertFalse(res["valid"])
        self.assertIn("Missing mandatory entrypoint 'def execute(data=None):'", res["error"])

    def test_execute_with_no_arguments(self):
        code = '''
def execute():
    return {"status": "success"}
'''
        res = validate_python_syntax(code)
        self.assertFalse(res["valid"])
        self.assertIn("must accept at least 1 argument", res["error"])


class TestSQLiteWALStorage(unittest.TestCase):
    """Test SQLite Write-Ahead Logging (WAL) configuration and schema integrity."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_lab.sqlite")

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_wal_journal_mode(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode = WAL;")
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode;")
        mode = cursor.fetchone()[0]
        self.assertEqual(mode.lower(), "wal")

        conn.execute("""
            CREATE TABLE intents (
                intent_key TEXT PRIMARY KEY,
                canonical_prompt TEXT NOT NULL,
                status TEXT DEFAULT 'ACTIVE',
                consecutive_failures INTEGER DEFAULT 0,
                execution_count INTEGER DEFAULT 0
            );
        """)
        conn.execute("INSERT INTO intents (intent_key, canonical_prompt) VALUES ('test_key', 'test prompt');")
        conn.commit()

        cursor.execute("SELECT * FROM intents WHERE intent_key = 'test_key';")
        row = cursor.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "test_key")
        conn.close()


class TestCircuitBreaker(unittest.TestCase):
    """Test Circuit Breaker state machine (consecutive failures threshold and quarantine lock)."""

    def setUp(self):
        self.consecutive_failures = 0
        self.status = "ACTIVE"
        self.MAX_FAILURES = 3

    def record_execution(self, success: bool):
        if success:
            self.consecutive_failures = 0
            self.status = "ACTIVE"
        else:
            self.consecutive_failures += 1
            if self.consecutive_failures >= self.MAX_FAILURES:
                self.status = "QUARANTINED"

    def reset_breaker(self):
        self.consecutive_failures = 0
        self.status = "ACTIVE"

    def test_circuit_breaker_healthy(self):
        self.record_execution(True)
        self.assertEqual(self.status, "ACTIVE")
        self.assertEqual(self.consecutive_failures, 0)

    def test_circuit_breaker_trips_at_three_failures(self):
        self.record_execution(False)
        self.assertEqual(self.consecutive_failures, 1)
        self.assertEqual(self.status, "ACTIVE")

        self.record_execution(False)
        self.assertEqual(self.consecutive_failures, 2)
        self.assertEqual(self.status, "ACTIVE")

        # 3rd failure trips the circuit breaker to QUARANTINED
        self.record_execution(False)
        self.assertEqual(self.consecutive_failures, 3)
        self.assertEqual(self.status, "QUARANTINED")

    def test_circuit_breaker_resets_on_success(self):
        self.record_execution(False)
        self.record_execution(False)
        self.record_execution(True)  # Recovered
        self.assertEqual(self.consecutive_failures, 0)
        self.assertEqual(self.status, "ACTIVE")

    def test_manual_quarantine_reset(self):
        self.record_execution(False)
        self.record_execution(False)
        self.record_execution(False)
        self.assertEqual(self.status, "QUARANTINED")

        self.reset_breaker()
        self.assertEqual(self.status, "ACTIVE")
        self.assertEqual(self.consecutive_failures, 0)


class TestIsolatedRunnerExecution(unittest.TestCase):
    """Test ephemeral container script runner execution contract."""

    def test_script_execution_and_json_serialization(self):
        script_code = '''
def execute(data=None):
    payload = data or {}
    return {
        "status": "success",
        "result": {"echo": payload.get("val", 0) * 2}
    }
'''
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(script_code)
            temp_path = f.name

        try:
            cmd = [
                "python3", "-c",
                f"import sys, json, importlib.util; "
                f"spec = importlib.util.spec_from_file_location('module', '{temp_path}'); "
                f"mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); "
                f"res = mod.execute({{'val': 21}}); print(json.dumps(res))"
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0)
            parsed = json.loads(result.stdout.strip())
            self.assertEqual(parsed["status"], "success")
            self.assertEqual(parsed["result"]["echo"], 42)
        finally:
            os.remove(temp_path)


if __name__ == "__main__":
    unittest.main()
