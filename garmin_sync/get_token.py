"""Run this ONCE on your own computer to sign in to Garmin Connect.

It prints a token (not your password) that you paste into a GitHub secret
named GARMIN_TOKENS. The GitHub Action uses it to read your stats.

    pip install -r garmin_sync/requirements.txt
    python garmin_sync/get_token.py
"""

from getpass import getpass

from garminconnect import Garmin


def main():
    print("Sign in to Garmin Connect (your password is only sent to Garmin).")
    email = input("Garmin email: ").strip()
    password = getpass("Garmin password: ")
    api = Garmin(email=email, password=password, prompt_mfa=lambda: input("Garmin MFA code: ").strip())
    api.login()
    token = api.client.dumps()
    name = api.get_full_name() if hasattr(api, "get_full_name") else "you"

    print(f"\nSigned in as {name}.")
    print("\nCopy EVERYTHING on the next line into a GitHub secret named GARMIN_TOKENS:\n")
    print(token)
    print("\nTreat it like a password: don't share it or commit it to the repo.")


if __name__ == "__main__":
    main()
