
import firebase_admin
from firebase_admin import credentials, firestore

# This script attempts to use default credentials or prompts for a path
# Since I don't have a service account key, I'll try to initialize with the project ID
# and hope the environment has ambient credentials or I can just use the public API if allowed.
# Actually, firebase-admin usually needs a service account for backend access.
# I will write a script that helps the user check if they have a key.

import sys
import json

def check_students():
    try:
        # Try to initialize without explicit cert if running in a GCP environment
        # or if GOOGLE_APPLICATION_CREDENTIALS is set.
        # Otherwise, this will fail.
        firebase_admin.initialize_app()
        db = firestore.client()
        
        print("Successfully connected to Firestore.")
        
        # 1. Check collection name and list some doc IDs
        students_ref = db.collection('students')
        docs = students_ref.limit(10).stream()
        
        print("\n--- First 10 students (or less) ---")
        found_any = False
        for doc in docs:
            found_any = True
            print(f"ID: {doc.id} => Data: {doc.to_dict()}")
        
        if not found_any:
            print("No documents found in 'students' collection.")

        # 2. Check for Jayden Marshall
        email_to_check = 'jayden_marshal@students.edu.sg'
        print(f"\n--- Checking for {email_to_check} ---")
        
        # Check direct ID (lowercase)
        doc_ref = students_ref.document(email_to_check.lower())
        doc_snap = doc_ref.get()
        if doc_snap.exists:
            print(f"Found via ID: {doc_snap.id}")
            print(f"Data: {doc_snap.to_dict()}")
        else:
            print("Not found by exact ID (lowercase email).")
            
            # Search by email field
            query = students_ref.where('email', '==', email_to_check).stream()
            query_results = list(query)
            if query_results:
                for d in query_results:
                    print(f"Found via query: {d.id}")
                    print(f"Data: {d.to_dict()}")
            else:
                print("Not found via query on 'email' field either.")

    except Exception as e:
        print(f"Error: {e}")
        print("\nTip: If you haven't set up a service account, you might need a JSON key file.")
        print("You can set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json")

if __name__ == "__main__":
    check_students()
